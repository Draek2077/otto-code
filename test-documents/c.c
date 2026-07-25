/*
 * A self-contained bitmap-free Mandelbrot renderer, in ASCII.
 *
 * Exercises preprocessor directives, structs, pointers, fixed-width types,
 * const correctness and format strings.
 */

#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define WIDTH 78
#define HEIGHT 26
#define MAX_ITERATIONS 96

static const char RAMP[] = " .:-=+*#%@";
#define RAMP_LENGTH (sizeof(RAMP) - 1)

typedef struct {
    double real;
    double imag;
} Complex;

static int escape_time(Complex c) {
    Complex z = {0.0, 0.0};
    for (int i = 0; i < MAX_ITERATIONS; ++i) {
        const double real = z.real * z.real - z.imag * z.imag + c.real;
        const double imag = 2.0 * z.real * z.imag + c.imag;
        z.real = real;
        z.imag = imag;
        if (z.real * z.real + z.imag * z.imag > 4.0) {
            return i;
        }
    }
    return MAX_ITERATIONS;
}

static void render(char *buffer, size_t capacity) {
    size_t offset = 0;

    for (int row = 0; row < HEIGHT; ++row) {
        for (int col = 0; col < WIDTH; ++col) {
            const Complex c = {
                .real = (col - WIDTH * 0.72) * 3.2 / WIDTH,
                .imag = (row - HEIGHT * 0.5) * 2.4 / HEIGHT,
            };
            const int iterations = escape_time(c);
            const char shade = RAMP[(iterations * (RAMP_LENGTH - 1)) / MAX_ITERATIONS];
            if (offset + 1 < capacity) {
                buffer[offset++] = shade;
            }
        }
        if (offset + 1 < capacity) {
            buffer[offset++] = '\n';
        }
    }
    buffer[offset] = '\0';
}

int main(void) {
    static char canvas[(WIDTH + 1) * HEIGHT + 1];
    memset(canvas, 0, sizeof canvas);
    render(canvas, sizeof canvas);
    fputs(canvas, stdout);
    printf("%d iterations max, %zu shades\n", MAX_ITERATIONS, RAMP_LENGTH);
    return 0;
}
