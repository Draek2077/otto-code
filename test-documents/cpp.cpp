// A self-contained N-body step, integrated with velocity Verlet.
//
// Exercises templates, RAII, operator overloading, structured bindings,
// ranges-free algorithms, constexpr and lambdas.

#include <algorithm>
#include <array>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <string>
#include <vector>

namespace sky {

struct Vec2 {
    double x{0.0};
    double y{0.0};

    constexpr Vec2 operator+(const Vec2& other) const { return {x + other.x, y + other.y}; }
    constexpr Vec2 operator-(const Vec2& other) const { return {x - other.x, y - other.y}; }
    constexpr Vec2 operator*(double scale) const { return {x * scale, y * scale}; }

    [[nodiscard]] double length() const { return std::sqrt(x * x + y * y); }
};

struct Body {
    std::string name;
    double mass;
    Vec2 position;
    Vec2 velocity;
};

constexpr double kGravity = 6.674e-11;

Vec2 accelerationOn(const Body& body, const std::vector<Body>& others) {
    Vec2 total{};
    for (const auto& other : others) {
        if (&other == &body) continue;
        const Vec2 offset = other.position - body.position;
        const double distance = std::max(offset.length(), 1.0);
        const double magnitude = kGravity * other.mass / (distance * distance * distance);
        total = total + offset * magnitude;
    }
    return total;
}

void step(std::vector<Body>& bodies, double dt) {
    std::vector<Vec2> accelerations;
    accelerations.reserve(bodies.size());

    std::transform(bodies.begin(), bodies.end(), std::back_inserter(accelerations),
                   [&](const Body& body) { return accelerationOn(body, bodies); });

    for (std::size_t i = 0; i < bodies.size(); ++i) {
        auto& [name, mass, position, velocity] = bodies[i];
        velocity = velocity + accelerations[i] * dt;
        position = position + velocity * dt;
    }
}

}  // namespace sky

int main() {
    std::vector<sky::Body> system{
        {"Primary", 1.989e30, {0.0, 0.0}, {0.0, 0.0}},
        {"Companion", 5.972e24, {1.496e11, 0.0}, {0.0, 29780.0}},
    };

    for (int tick = 0; tick < 3; ++tick) {
        sky::step(system, 3600.0);
    }

    std::cout << std::fixed << std::setprecision(0);
    for (const auto& body : system) {
        std::cout << body.name << " at (" << body.position.x << ", " << body.position.y << ")\n";
    }
    return 0;
}
