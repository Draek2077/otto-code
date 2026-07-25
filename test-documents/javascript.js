/**
 * Morse code, both directions, with no dependencies.
 * Exercises template literals, generators, destructuring, classes and regex.
 */

const MORSE = {
  a: ".-", b: "-...", c: "-.-.", d: "-..", e: ".", f: "..-.",
  g: "--.", h: "....", i: "..", j: ".---", k: "-.-", l: ".-..",
  m: "--", n: "-.", o: "---", p: ".--.", q: "--.-", r: ".-.",
  s: "...", t: "-", u: "..-", v: "...-", w: ".--", x: "-..-",
  y: "-.--", z: "--..", 0: "-----", 1: ".----", 2: "..---",
  3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...",
  8: "---..", 9: "----.",
};

const REVERSE = Object.fromEntries(Object.entries(MORSE).map(([k, v]) => [v, k]));

export class Signal {
  #text;

  constructor(text) {
    this.#text = String(text).toLowerCase();
  }

  encode() {
    return this.#text
      .replace(/[^a-z0-9 ]/g, "")
      .split(" ")
      .map((word) => [...word].map((char) => MORSE[char] ?? "").join(" "))
      .join(" / ");
  }

  static decode(morse) {
    return morse
      .split(" / ")
      .map((word) => word.split(/\s+/).map((code) => REVERSE[code] ?? "?").join(""))
      .join(" ");
  }

  *pulses() {
    for (const symbol of this.encode()) {
      yield symbol === "." ? 1 : symbol === "-" ? 3 : 0;
    }
  }
}

const distress = new Signal("SOS from Fastnet");
console.log(distress.encode());
console.log(Signal.decode(distress.encode()));
console.log(`total pulse units: ${[...distress.pulses()].reduce((a, b) => a + b, 0)}`);
