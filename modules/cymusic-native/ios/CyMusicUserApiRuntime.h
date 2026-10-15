#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

// Owns the independent JSC context and all its work on one serial queue.
@interface CyMusicUserApiRuntime : NSObject

- (instancetype)initWithPreloadURL:(nullable NSURL *)preloadURL
                     eventHandler:(void (^)(NSDictionary<NSString *, id> *event))eventHandler
    NS_DESIGNATED_INITIALIZER;
- (instancetype)init NS_UNAVAILABLE;

// Returns the new generation after enqueueing; it does not wait for script init.
- (NSString *)loadScript:(NSDictionary<NSString *, NSString *> *)data;
- (void)sendAction:(NSString *)action info:(NSString *)info generation:(NSString *)generation;
- (NSString *)destroy;
- (void)startObserving;
- (void)stopObserving;
- (void)invalidate;

@end

// The sound processor observes RNTP's AVPlayer without owning its transport.
@interface CyMusicSoundEffectsProcessor : NSObject
- (nullable instancetype)initWithStatusHandler:(void (^)(NSDictionary<NSString *, id> *status))handler;
- (NSDictionary<NSString *, id> *)configureEnabled:(BOOL)enabled
                                            bands:(NSArray<NSNumber *> *)bands
                                    volumeBalance:(BOOL)volumeBalance
                                         revision:(double)revision
    NS_SWIFT_NAME(configure(enabled:bands:volumeBalance:revision:));
- (void)invalidate;
@end

NS_ASSUME_NONNULL_END
