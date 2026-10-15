#import "CyMusicUserApiRuntime.h"
#import "CyMusicSoundDSP.h"
@import AVFoundation;
@import MediaToolbox;
#include <stdatomic.h>
#include <math.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>

// Main-thread writers publish atomics; the realtime thread never waits for a lock.
typedef struct {
  atomic_uint references;
  atomic_uint sequence;
  atomic_uint generation;
  atomic_bool enabled;
  atomic_bool balance;
  _Atomic(float) bands[5];
  // Tag status with its item generation so retired callbacks can never mark a new item active.
  atomic_uint_fast64_t processing; // low bits: 0 awaiting, 1 processing, 2 format, 3 source error
} CYEffectsShared;

typedef struct {
  CYEffectsShared *shared;
  unsigned generation;
  CYDSP *dsp;
  unsigned channels;
  bool planar;
  bool enabled;
  bool balance;
  double bands[5];
} CYEffectsTap;

static void CYReleaseShared(CYEffectsShared *shared) {
  if (atomic_fetch_sub(&shared->references, 1) == 1) free(shared);
}

static void CYReportProcessing(CYEffectsTap *context, int state) {
  atomic_store(&context->shared->processing, ((uint64_t)context->generation << 2) | (unsigned)state);
}

static void CYTapInit(MTAudioProcessingTapRef tap, void *clientInfo, void **storage) {
  *storage = clientInfo;
}

static void CYTapFinalize(MTAudioProcessingTapRef tap) {
  CYEffectsTap *context = MTAudioProcessingTapGetStorage(tap);
  CYDSPDestroy(context->dsp);
  CYReleaseShared(context->shared);
  free(context);
}

static void CYTapPrepare(MTAudioProcessingTapRef tap, CMItemCount maxFrames,
                         const AudioStreamBasicDescription *format) {
  CYEffectsTap *context = MTAudioProcessingTapGetStorage(tap);
  CYDSPDestroy(context->dsp);
  context->dsp = NULL;
  context->channels = format->mChannelsPerFrame;
  context->planar = (format->mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0;
  // Leave unfamiliar PCM layouts untouched rather than interpreting their bytes as floats.
  if (format->mFormatID != kAudioFormatLinearPCM ||
      !(format->mFormatFlags & kAudioFormatFlagIsFloat) ||
      (format->mFormatFlags & kAudioFormatFlagIsBigEndian) || format->mBitsPerChannel != 32 ||
      context->channels < 1 || context->channels > 8 ||
      format->mBytesPerFrame != sizeof(float) * (context->planar ? 1 : context->channels)) {
    CYReportProcessing(context, 2);
    return;
  }
  context->dsp = CYDSPCreate(format->mSampleRate, context->channels);
  CYReportProcessing(context, context->dsp ? 0 : 2);
}

static void CYTapUnprepare(MTAudioProcessingTapRef tap) {
  CYEffectsTap *context = MTAudioProcessingTapGetStorage(tap);
  CYDSPDestroy(context->dsp);
  context->dsp = NULL;
}

static void CYReadConfiguration(CYEffectsTap *context) {
  // Bounded retries: if a UI update crosses this block, reuse the last complete snapshot.
  for (unsigned attempt = 0; attempt < 3; attempt++) {
    unsigned before = atomic_load(&context->shared->sequence);
    if (before & 1) continue;
    bool enabled = atomic_load(&context->shared->enabled);
    bool balance = atomic_load(&context->shared->balance);
    double bands[5];
    for (unsigned i = 0; i < 5; i++) bands[i] = atomic_load(&context->shared->bands[i]);
    if (before != atomic_load(&context->shared->sequence)) continue;
    context->enabled = enabled;
    context->balance = balance;
    memcpy(context->bands, bands, sizeof(bands));
    break;
  }
}

static void CYTapProcess(MTAudioProcessingTapRef tap, CMItemCount requested,
                        MTAudioProcessingTapFlags flags, AudioBufferList *buffers,
                        CMItemCount *framesOut, MTAudioProcessingTapFlags *flagsOut) {
  CYEffectsTap *context = MTAudioProcessingTapGetStorage(tap);
  *framesOut = 0;
  *flagsOut = 0;
  OSStatus result = MTAudioProcessingTapGetSourceAudio(tap, requested, buffers, flagsOut, NULL, framesOut);
  if (result != noErr) {
    CYReportProcessing(context, 3);
    return;
  }
  // Process only frames actually delivered and propagate the source EOS/start flags.
  if (*framesOut <= 0 || !context->dsp) return;
  if ((*flagsOut | flags) & kMTAudioProcessingTapFlag_StartOfStream) CYDSPReset(context->dsp);
  unsigned channels = context->channels;
  if (buffers->mNumberBuffers != (context->planar ? channels : 1)) {
    CYReportProcessing(context, 2);
    return;
  }
  float *channelData[8];
  unsigned stride = context->planar ? 1 : channels;
  for (unsigned i = 0; i < buffers->mNumberBuffers; i++) {
    AudioBuffer *buffer = &buffers->mBuffers[i];
    if (!buffer->mData || buffer->mNumberChannels != (context->planar ? 1 : channels) ||
        buffer->mDataByteSize / (sizeof(float) * stride) < (size_t)*framesOut) {
      CYReportProcessing(context, 2);
      return;
    }
  }
  for (unsigned channel = 0; channel < channels; channel++)
    channelData[channel] = context->planar ? buffers->mBuffers[channel].mData
                                         : (float *)buffers->mBuffers[0].mData + channel;
  CYReadConfiguration(context);
  CYDSPConfigure(context->dsp, context->enabled, context->bands, context->balance);
  CYDSPProcess(context->dsp, channelData, (unsigned)*framesOut, stride);
  CYReportProcessing(context, 1);
}

static int CYItemObservation;
static int CYExternalObservation;

@implementation CyMusicSoundEffectsProcessor {
  CYEffectsShared *_shared;
  __weak AVPlayer *_player;
  AVPlayerItem *_item;
  AVAudioMix *_ownedMix;
  id _availabilityObserver;
  NSTimer *_statusTimer;
  BOOL _observingPlayer;
  BOOL _requested;
  BOOL _invalidated;
  unsigned _generation;
  double _revision;
  NSTimeInterval _playingWithoutPCM;
  NSDictionary *_status;
  void (^_handler)(NSDictionary<NSString *, id> *);
}

- (instancetype)initWithStatusHandler:(void (^)(NSDictionary<NSString *, id> *))handler {
  if ((self = [super init])) {
    _shared = calloc(1, sizeof(CYEffectsShared));
    if (!_shared) return nil;
    atomic_init(&_shared->references, 1);
    atomic_init(&_shared->sequence, 0);
    atomic_init(&_shared->generation, 0);
    atomic_init(&_shared->enabled, false);
    atomic_init(&_shared->balance, false);
    atomic_init(&_shared->processing, 0);
    for (unsigned i = 0; i < 5; i++) atomic_init(&_shared->bands[i], 0);
    _handler = [handler copy];
    __weak typeof(self) weakSelf = self;
    _availabilityObserver = [NSNotificationCenter.defaultCenter
      addObserverForName:@"CyMusicSoundEffectsPlayerAvailable" object:nil queue:NSOperationQueue.mainQueue
      usingBlock:^(NSNotification *note) {
        typeof(self) self = weakSelf;
        if (!self || self->_invalidated) return;
        if ([note.userInfo[@"released"] boolValue]) {
          if (note.object == self->_player) [self bindPlayer:nil];
        } else if ([note.object isKindOfClass:AVPlayer.class]) [self bindPlayer:note.object];
      }];
    // Also catches a player created before the settings/native module was loaded.
    [NSNotificationCenter.defaultCenter postNotificationName:@"CyMusicSoundEffectsRequestPlayer" object:nil];
  }
  return self;
}

- (NSDictionary<NSString *, id> *)configureEnabled:(BOOL)enabled bands:(NSArray<NSNumber *> *)bands
                                    volumeBalance:(BOOL)balance revision:(double)revision {
  if (_invalidated) return @{ @"state": @"error", @"reason": @"unavailable", @"revision": @(revision) };
  _revision = revision;
  atomic_fetch_add(&_shared->sequence, 1);
  atomic_store(&_shared->enabled, enabled);
  atomic_store(&_shared->balance, balance);
  for (unsigned i = 0; i < 5; i++) {
    double gain = i < bands.count ? bands[i].doubleValue : 0;
    atomic_store(&_shared->bands[i], isfinite(gain) ? fmax(-6, fmin(6, gain)) : 0);
  }
  atomic_fetch_add(&_shared->sequence, 1);
  _requested = enabled || balance;
  _playingWithoutPCM = 0;
  atomic_store(&_shared->processing, (uint64_t)_generation << 2);
  if (!_requested) {
    [self detachMix];
    [_statusTimer invalidate];
    _statusTimer = nil;
    [self publish:@"off" reason:nil];
  } else {
    [self publish:@"waiting" reason:nil];
    if (!_ownedMix) [self refreshItem];
    if (!_statusTimer) {
      __weak typeof(self) weakSelf = self;
      _statusTimer = [NSTimer timerWithTimeInterval:0.25 repeats:YES block:^(NSTimer *timer) {
        [weakSelf pollProcessing];
      }];
      [NSRunLoop.mainRunLoop addTimer:_statusTimer forMode:NSRunLoopCommonModes];
    }
  }
  return _status;
}

- (void)bindPlayer:(AVPlayer *)player {
  if (_player == player && _observingPlayer) return;
  if (_observingPlayer && _player) {
    [_player removeObserver:self forKeyPath:@"currentItem" context:&CYItemObservation];
    [_player removeObserver:self forKeyPath:@"externalPlaybackActive" context:&CYExternalObservation];
  }
  _observingPlayer = NO;
  [self detachMix];
  _player = player;
  if (player) {
    _observingPlayer = YES;
    [player addObserver:self forKeyPath:@"currentItem" options:NSKeyValueObservingOptionNew context:&CYItemObservation];
    [player addObserver:self forKeyPath:@"externalPlaybackActive" options:NSKeyValueObservingOptionNew context:&CYExternalObservation];
  }
  [self refreshItem];
}

- (void)observeValueForKeyPath:(NSString *)keyPath ofObject:(id)object change:(NSDictionary *)change context:(void *)context {
  if (context == &CYItemObservation || context == &CYExternalObservation) {
    if (NSThread.isMainThread) [self refreshItem];
    else {
      __weak typeof(self) weakSelf = self;
      dispatch_async(dispatch_get_main_queue(), ^{ [weakSelf refreshItem]; });
    }
  } else [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
}

- (void)detachMix {
  _generation++;
  atomic_store(&_shared->generation, _generation);
  atomic_store(&_shared->processing, (uint64_t)_generation << 2);
  if (_item.audioMix == _ownedMix && _ownedMix) _item.audioMix = nil;
  _ownedMix = nil;
  _item = nil;
  _playingWithoutPCM = 0;
}

- (void)refreshItem {
  if (_invalidated) return;
  [self detachMix];
  if (!_requested) { [self publish:@"off" reason:nil]; return; }
  AVPlayerItem *item = _player.currentItem;
  if (!item) { [self publish:@"waiting" reason:nil]; return; }
  if (_player.externalPlaybackActive) { [self publish:@"unsupported" reason:@"stream"]; return; }
  _item = item;
  unsigned generation = _generation;
  AVAsset *asset = item.asset;
  if ([asset isKindOfClass:AVURLAsset.class] &&
      [((AVURLAsset *)asset).URL.pathExtension.lowercaseString isEqualToString:@"m3u8"]) {
    [self publish:@"unsupported" reason:@"stream"];
    return;
  }
  [self publish:@"waiting" reason:nil];
  __weak typeof(self) weakSelf = self;
  [asset loadValuesAsynchronouslyForKeys:@[@"tracks", @"hasProtectedContent"] completionHandler:^{
    dispatch_async(dispatch_get_main_queue(), ^{
      typeof(self) self = weakSelf;
      if (!self || self->_invalidated || !self->_requested || self->_generation != generation || self->_player.currentItem != item) return;
      NSError *error;
      if ([asset statusOfValueForKey:@"tracks" error:&error] != AVKeyValueStatusLoaded ||
          [asset statusOfValueForKey:@"hasProtectedContent" error:&error] != AVKeyValueStatusLoaded || asset.hasProtectedContent) {
        [self publish:@"unsupported" reason:@"stream"];
        return;
      }
      NSArray<AVAssetTrack *> *tracks = [asset tracksWithMediaType:AVMediaTypeAudio];
      // Multiple independently mixed tracks need a mixdown tap. Keep their original mix intact.
      if (tracks.count != 1 || (item.audioMix && item.audioMix != self->_ownedMix)) {
        [self publish:@"unsupported" reason:@"stream"];
        return;
      }
      CYEffectsTap *context = calloc(1, sizeof(CYEffectsTap));
      if (!context) { [self publish:@"error" reason:@"processing"]; return; }
      context->shared = self->_shared;
      context->generation = generation;
      atomic_fetch_add(&self->_shared->references, 1);
      MTAudioProcessingTapCallbacks callbacks = {
        kMTAudioProcessingTapCallbacksVersion_0, context,
        CYTapInit, CYTapFinalize, CYTapPrepare, CYTapUnprepare, CYTapProcess
      };
      MTAudioProcessingTapRef tap = NULL;
      OSStatus result = MTAudioProcessingTapCreate(kCFAllocatorDefault, &callbacks, kMTAudioProcessingTapCreationFlag_PostEffects, &tap);
      if (result != noErr || !tap) {
        CYReleaseShared(context->shared);
        free(context);
        [self publish:@"error" reason:@"processing"];
        return;
      }
      AVMutableAudioMixInputParameters *parameters = [AVMutableAudioMixInputParameters audioMixInputParametersWithTrack:tracks.firstObject];
      parameters.audioTapProcessor = tap;
      CFRelease(tap);
      AVMutableAudioMix *mix = AVMutableAudioMix.audioMix;
      mix.inputParameters = @[parameters];
      self->_ownedMix = mix;
      item.audioMix = mix;
    });
  }];
}

- (void)pollProcessing {
  if (!_requested || _invalidated) return;
  uint64_t reported = atomic_load(&_shared->processing);
  int processing = (reported >> 2) == _generation ? (reported & 3) : 0;
  if (processing == 1) { [self publish:@"active" reason:nil]; return; }
  if (processing == 2) { [self publish:@"unsupported" reason:@"format"]; return; }
  if (processing == 3) { [self publish:@"error" reason:@"processing"]; return; }
  if ([_status[@"state"] isEqual:@"unsupported"] || [_status[@"state"] isEqual:@"error"]) return;
  // Some remote layouts accept an audioMix but never deliver PCM to the tap.
  // Count playback time only: pausing or buffering must not look like a failure.
  if (_player.timeControlStatus == AVPlayerTimeControlStatusPlaying) _playingWithoutPCM += 0.25;
  if (_playingWithoutPCM >= 4) [self publish:@"unsupported" reason:@"stream"];
}

- (void)publish:(NSString *)state reason:(NSString *)reason {
  NSMutableDictionary *status = [@{ @"state": state, @"revision": @(_revision) } mutableCopy];
  if (reason) status[@"reason"] = reason;
  if ([_status isEqualToDictionary:status]) return;
  _status = status;
  if (_handler) _handler(status);
}

- (void)invalidate {
  if (_invalidated) return;
  _invalidated = YES;
  [_statusTimer invalidate];
  _statusTimer = nil;
  [NSNotificationCenter.defaultCenter removeObserver:_availabilityObserver];
  _availabilityObserver = nil;
  [self bindPlayer:nil];
  _handler = nil;
}

- (void)dealloc {
  [self invalidate];
  if (_shared) CYReleaseShared(_shared);
}
@end
