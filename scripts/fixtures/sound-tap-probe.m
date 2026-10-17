@import Foundation;
@import AVFoundation;
@import MediaToolbox;
#include <assert.h>
#include <stdio.h>

static CMItemCount sourceFrames;
static MTAudioProcessingTapFlags sourceFlags;
static OSStatus sourceError;
static void *CYProbeStorage(MTAudioProcessingTapRef tap) { return (void *)tap; }
static OSStatus CYProbeSourceAudio(MTAudioProcessingTapRef tap, CMItemCount frames,
                                  AudioBufferList *buffers, MTAudioProcessingTapFlags *flags,
                                  CMTimeRange *range, CMItemCount *actual) {
  if (sourceError) return sourceError;
  *flags = sourceFlags;
  *actual = sourceFrames;
  return noErr;
}

// Compile the actual native owner. Only the decoder input/storage seams are substituted.
#define MTAudioProcessingTapGetStorage CYProbeStorage
#define MTAudioProcessingTapGetSourceAudio CYProbeSourceAudio
#include "../../modules/cymusic-native/ios/CyMusicSoundEffectsProcessor.m"
#undef MTAudioProcessingTapGetStorage
#undef MTAudioProcessingTapGetSourceAudio

typedef struct { UInt32 mNumberBuffers; AudioBuffer mBuffers[8]; } CYTestBuffers;

static AudioStreamBasicDescription format(double rate, unsigned channels, bool planar) {
  AudioStreamBasicDescription result = {0};
  result.mSampleRate = rate;
  result.mFormatID = kAudioFormatLinearPCM;
  result.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked |
    (planar ? kAudioFormatFlagIsNonInterleaved : 0);
  result.mChannelsPerFrame = channels;
  result.mBitsPerChannel = 32;
  result.mBytesPerFrame = result.mBytesPerPacket = sizeof(float) * (planar ? 1 : channels);
  result.mFramesPerPacket = 1;
  return result;
}

static void testCallbacks(void) {
  CYEffectsShared *shared = calloc(1, sizeof(*shared));
  atomic_init(&shared->references, 2);
  atomic_init(&shared->sequence, 0);
  atomic_init(&shared->generation, 1);
  atomic_init(&shared->processing, 0);
  atomic_init(&shared->enabled, true);
  atomic_init(&shared->balance, false);
  for (unsigned i = 0; i < 5; i++) atomic_init(&shared->bands[i], i == 0 ? 6 : 0);
  CYEffectsTap *context = calloc(1, sizeof(*context));
  context->shared = shared;
  context->generation = 1;
  MTAudioProcessingTapRef tap = (MTAudioProcessingTapRef)context;
  AudioStreamBasicDescription pcm = format(48000, 2, true);
  CYTapPrepare(tap, 64, &pcm);
  assert(context->dsp);
  float left[64], right[64];
  for (unsigned i = 0; i < 64; i++) { left[i] = 0.25; right[i] = 0; }
  CYTestBuffers buffers = { .mNumberBuffers = 2, .mBuffers = {
    { 1, sizeof(left), left }, { 1, sizeof(right), right }
  }};
  sourceFrames = 7;
  sourceFlags = kMTAudioProcessingTapFlag_EndOfStream;
  CMItemCount actual = -1;
  MTAudioProcessingTapFlags flags = 0;
  CYTapProcess(tap, 64, 0, (AudioBufferList *)&buffers, &actual, &flags);
  assert(actual == 7 && flags == kMTAudioProcessingTapFlag_EndOfStream);
  assert(left[0] != 0.25f);
  for (unsigned i = 7; i < 64; i++) assert(left[i] == 0.25f);
  for (unsigned i = 0; i < 64; i++) assert(right[i] == 0);
  assert(atomic_load(&shared->processing) == ((1U << 2) | 1U));
  puts("PASS real tap processes only delivered planar frames and propagates EOS without channel leakage");

  // An old callback may finish after the main thread has moved to another item.
  atomic_store(&shared->generation, 2);
  atomic_store(&shared->processing, 2U << 2);
  CYTapProcess(tap, 64, 0, (AudioBufferList *)&buffers, &actual, &flags);
  assert((atomic_load(&shared->processing) >> 2) != atomic_load(&shared->generation));
  puts("PASS retired tap results carry their old generation and cannot mark the new item active");

  pcm.mFormatFlags = kAudioFormatFlagIsSignedInteger | kAudioFormatFlagIsPacked;
  pcm.mBitsPerChannel = 16;
  pcm.mBytesPerFrame = pcm.mBytesPerPacket = 4;
  CYTapPrepare(tap, 64, &pcm);
  assert(!context->dsp);
  float untouched = left[0];
  CYTapProcess(tap, 64, 0, (AudioBufferList *)&buffers, &actual, &flags);
  assert(left[0] == untouched && actual == 7);
  assert((atomic_load(&shared->processing) & 3) == 2);
  puts("PASS unfamiliar PCM is reported and passed through without interpreting its bytes");

  float packed[128];
  for (unsigned i = 0; i < 128; i++) packed[i] = i % 2 ? 0 : 0.25;
  pcm = format(44100, 2, false);
  CYTapPrepare(tap, 64, &pcm);
  buffers.mNumberBuffers = 1;
  buffers.mBuffers[0] = (AudioBuffer){2, sizeof(packed), packed};
  sourceFrames = 11;
  sourceFlags = kMTAudioProcessingTapFlag_StartOfStream;
  CYTapProcess(tap, 64, 0, (AudioBufferList *)&buffers, &actual, &flags);
  assert(actual == 11 && flags == kMTAudioProcessingTapFlag_StartOfStream);
  for (unsigned i = 0; i < 64; i++) assert(packed[i * 2 + 1] == 0);
  for (unsigned i = 11; i < 64; i++) assert(packed[i * 2] == 0.25f);
  float first = packed[0];
  for (unsigned i = 0; i < 128; i++) packed[i] = i % 2 ? 0 : 0.25;
  CYTapProcess(tap, 64, 0, (AudioBufferList *)&buffers, &actual, &flags);
  assert(first == packed[0]);
  puts("PASS interleaved PCM and format changes work and start-of-stream resets filter history");

  sourceError = -50;
  CYTapProcess(tap, 64, 0, (AudioBufferList *)&buffers, &actual, &flags);
  assert(actual == 0 && flags == 0 && (atomic_load(&shared->processing) & 3) == 3);
  CYTapUnprepare(tap);
  assert(!context->dsp);
  CYTapFinalize(tap);
  assert(atomic_load(&shared->references) == 1);
  CYReleaseShared(shared);
  puts("PASS decoder errors produce no stale frames and tap disposal releases owned DSP state");
}

static void testOwnerLifecycle(void) {
  __block unsigned events = 0;
  __block NSDictionary *latestStatus;
  CyMusicSoundEffectsProcessor *processor = [[CyMusicSoundEffectsProcessor alloc]
    initWithStatusHandler:^(NSDictionary *status) { events++; latestStatus = status; }];
  assert(processor);
  NSDictionary *off = [processor configureEnabled:NO bands:@[] volumeBalance:NO revision:1];
  assert([off[@"state"] isEqual:@"off"]);
  NSDictionary *waiting = [processor configureEnabled:NO bands:@[] volumeBalance:YES revision:2];
  assert([waiting[@"state"] isEqual:@"idle"] && [waiting[@"reason"] isEqual:@"playback"] && [waiting[@"revision"] doubleValue] == 2);
  AVPlayer *player = [AVPlayer new];
  [NSNotificationCenter.defaultCenter postNotificationName:@"CyMusicSoundEffectsPlayerAvailable" object:player];
  [processor pollProcessing];
  assert([latestStatus[@"state"] isEqual:@"idle"]);
  assert([latestStatus[@"reason"] isEqual:@"playback"]);
  [NSNotificationCenter.defaultCenter postNotificationName:@"CyMusicSoundEffectsPlayerAvailable" object:player userInfo:@{@"released": @YES}];
  [processor invalidate];
  unsigned count = events;
  [NSNotificationCenter.defaultCenter postNotificationName:@"CyMusicSoundEffectsPlayerAvailable" object:player];
  assert(events == count);
  NSDictionary *retired = [processor configureEnabled:YES bands:@[] volumeBalance:NO revision:3];
  assert([retired[@"state"] isEqual:@"error"]);
  puts("PASS actual native owner handles off, independent balancing, player availability and idempotent disposal");
}

int main(void) {
  @autoreleasepool {
    testCallbacks();
    testOwnerLifecycle();
    puts("6 sound tap native checks passed");
  }
  return 0;
}
