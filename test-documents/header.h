/*
 * ringbuffer.h — a header-only single-producer ring buffer.
 *
 * Self-contained: include it, use it, no .c file required.
 * Exercises include guards, macros, inline functions and typedefs.
 */

#ifndef FIELD_NOTEBOOK_RINGBUFFER_H
#define FIELD_NOTEBOOK_RINGBUFFER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Capacity must be a power of two so the mask trick works. */
#define RB_CAPACITY 64u
#define RB_MASK (RB_CAPACITY - 1u)

#if (RB_CAPACITY & RB_MASK) != 0
#error "RB_CAPACITY must be a power of two"
#endif

typedef struct {
    uint32_t head;
    uint32_t tail;
    double samples[RB_CAPACITY];
} RingBuffer;

static inline void rb_init(RingBuffer *rb) {
    rb->head = 0u;
    rb->tail = 0u;
}

static inline size_t rb_count(const RingBuffer *rb) {
    return (size_t)(rb->head - rb->tail);
}

static inline bool rb_is_full(const RingBuffer *rb) {
    return rb_count(rb) == RB_CAPACITY;
}

static inline bool rb_push(RingBuffer *rb, double value) {
    if (rb_is_full(rb)) {
        return false;
    }
    rb->samples[rb->head & RB_MASK] = value;
    rb->head++;
    return true;
}

static inline bool rb_pop(RingBuffer *rb, double *out) {
    if (rb_count(rb) == 0u) {
        return false;
    }
    *out = rb->samples[rb->tail & RB_MASK];
    rb->tail++;
    return true;
}

/** Mean of everything currently buffered; NaN-free for an empty buffer. */
static inline double rb_mean(const RingBuffer *rb) {
    const size_t count = rb_count(rb);
    if (count == 0u) {
        return 0.0;
    }
    double total = 0.0;
    for (uint32_t i = rb->tail; i != rb->head; ++i) {
        total += rb->samples[i & RB_MASK];
    }
    return total / (double)count;
}

#ifdef __cplusplus
}  /* extern "C" */
#endif

#endif /* FIELD_NOTEBOOK_RINGBUFFER_H */
