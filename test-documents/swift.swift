//
//  swift.swift — a self-contained great-circle navigator.
//
//  Exercises structs, protocols, extensions, enums with associated values,
//  optionals, generics, result builders-free closures and property wrappers.
//

import Foundation

struct Coordinate: Equatable, CustomStringConvertible {
    let latitude: Double
    let longitude: Double

    var description: String {
        let ns = latitude >= 0 ? "N" : "S"
        let ew = longitude >= 0 ? "E" : "W"
        return String(format: "%.4f°%@ %.4f°%@", abs(latitude), ns, abs(longitude), ew)
    }
}

protocol Navigable {
    var position: Coordinate { get }
    func distance(to other: Self) -> Measurement<UnitLength>
}

enum Landfall {
    case reached(Coordinate)
    case missed(by: Measurement<UnitLength>)
    case unknown
}

struct Waypoint: Navigable {
    let name: String
    let position: Coordinate

    private static let earthRadiusMetres = 6_371_008.8

    func distance(to other: Waypoint) -> Measurement<UnitLength> {
        let φ1 = position.latitude * .pi / 180
        let φ2 = other.position.latitude * .pi / 180
        let Δφ = φ2 - φ1
        let Δλ = (other.position.longitude - position.longitude) * .pi / 180

        let a = sin(Δφ / 2) * sin(Δφ / 2)
            + cos(φ1) * cos(φ2) * sin(Δλ / 2) * sin(Δλ / 2)
        let c = 2 * atan2(sqrt(a), sqrt(1 - a))

        return Measurement(value: Self.earthRadiusMetres * c, unit: .meters)
    }
}

extension Array where Element == Waypoint {
    /// Total distance along the route, or nil for a route of fewer than two points.
    func routeLength() -> Measurement<UnitLength>? {
        guard count >= 2 else { return nil }
        return zip(self, dropFirst())
            .map { $0.distance(to: $1) }
            .reduce(Measurement(value: 0, unit: UnitLength.meters), +)
    }
}

let route = [
    Waypoint(name: "Fastnet", position: Coordinate(latitude: 51.3936, longitude: -9.6033)),
    Waypoint(name: "Eddystone", position: Coordinate(latitude: 50.1789, longitude: -4.2586)),
    Waypoint(name: "Bell Rock", position: Coordinate(latitude: 56.4372, longitude: -2.3872)),
]

for waypoint in route {
    print("\(waypoint.name.padding(toLength: 12, withPad: " ", startingAt: 0)) \(waypoint.position)")
}

if let total = route.routeLength() {
    let nauticalMiles = total.converted(to: .nauticalMiles)
    print(String(format: "Route: %.1f nm", nauticalMiles.value))
}

let outcome: Landfall = .missed(by: Measurement(value: 320, unit: .meters))
switch outcome {
case .reached(let where_): print("Landfall at \(where_)")
case .missed(let by): print("Missed by \(by)")
case .unknown: print("No fix")
}
