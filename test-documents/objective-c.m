//
//  objective-c.m — a self-contained star catalogue.
//
//  Exercises interfaces, properties, categories, blocks, message sends
//  and the square-bracket syntax that makes Objective-C look like nothing else.
//

#import <Foundation/Foundation.h>

typedef NS_ENUM(NSInteger, SpectralClass) {
    SpectralClassO = 0,
    SpectralClassB,
    SpectralClassA,
    SpectralClassF,
    SpectralClassG,
    SpectralClassK,
    SpectralClassM
};

@interface Star : NSObject

@property (nonatomic, copy, readonly) NSString *name;
@property (nonatomic, assign, readonly) double magnitude;
@property (nonatomic, assign, readonly) SpectralClass spectralClass;

- (instancetype)initWithName:(NSString *)name
                   magnitude:(double)magnitude
               spectralClass:(SpectralClass)spectralClass NS_DESIGNATED_INITIALIZER;

- (BOOL)isBrighterThan:(Star *)other;

@end

@implementation Star

- (instancetype)initWithName:(NSString *)name
                   magnitude:(double)magnitude
               spectralClass:(SpectralClass)spectralClass {
    self = [super init];
    if (self) {
        _name = [name copy];
        _magnitude = magnitude;
        _spectralClass = spectralClass;
    }
    return self;
}

- (instancetype)init {
    return [self initWithName:@"Unnamed" magnitude:99.0 spectralClass:SpectralClassM];
}

// Lower magnitudes are brighter. Astronomy's revenge on intuition.
- (BOOL)isBrighterThan:(Star *)other {
    return self.magnitude < other.magnitude;
}

- (NSString *)description {
    static NSString *const letters[] = {@"O", @"B", @"A", @"F", @"G", @"K", @"M"};
    return [NSString stringWithFormat:@"%@ (%@, mag %.2f)",
            self.name, letters[self.spectralClass], self.magnitude];
}

@end

@interface NSArray (Brightest)
- (Star *)brightestStar;
@end

@implementation NSArray (Brightest)

- (Star *)brightestStar {
    __block Star *best = nil;
    [self enumerateObjectsUsingBlock:^(Star *star, NSUInteger index, BOOL *stop) {
        if (best == nil || [star isBrighterThan:best]) {
            best = star;
        }
        if (star.magnitude < -1.4) {
            *stop = YES;
        }
    }];
    return best;
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSArray<Star *> *catalogue = @[
            [[Star alloc] initWithName:@"Vega" magnitude:0.03 spectralClass:SpectralClassA],
            [[Star alloc] initWithName:@"Sirius" magnitude:-1.46 spectralClass:SpectralClassA],
            [[Star alloc] initWithName:@"Betelgeuse" magnitude:0.50 spectralClass:SpectralClassM],
        ];

        for (Star *star in catalogue) {
            NSLog(@"%@", star);
        }
        NSLog(@"Brightest: %@", [catalogue brightestStar].name);
    }
    return 0;
}
