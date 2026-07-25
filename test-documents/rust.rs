//! A self-contained run-length encoder, and its inverse.
//!
//! Exercises traits, generics, lifetimes, pattern matching, iterators,
//! `Result`, derive macros and inline tests.

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Run {
    pub symbol: char,
    pub count: usize,
}

impl fmt::Display for Run {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.count {
            1 => write!(f, "{}", self.symbol),
            n => write!(f, "{}{}", n, self.symbol),
        }
    }
}

#[derive(Debug)]
pub enum DecodeError {
    DanglingCount(usize),
}

pub fn encode(input: &str) -> Vec<Run> {
    let mut runs: Vec<Run> = Vec::new();
    for symbol in input.chars() {
        match runs.last_mut() {
            Some(run) if run.symbol == symbol => run.count += 1,
            _ => runs.push(Run { symbol, count: 1 }),
        }
    }
    runs
}

pub fn decode(runs: &[Run]) -> String {
    runs.iter()
        .flat_map(|run| std::iter::repeat(run.symbol).take(run.count))
        .collect()
}

pub fn parse(encoded: &str) -> Result<Vec<Run>, DecodeError> {
    let mut runs = Vec::new();
    let mut digits = String::new();

    for (index, ch) in encoded.char_indices() {
        if ch.is_ascii_digit() {
            digits.push(ch);
        } else {
            let count = digits.parse().unwrap_or(1);
            digits.clear();
            runs.push(Run { symbol: ch, count });
            let _ = index;
        }
    }

    if digits.is_empty() {
        Ok(runs)
    } else {
        Err(DecodeError::DanglingCount(encoded.len()))
    }
}

fn main() {
    let sentence = "aaabccddddde";
    let runs = encode(sentence);
    let compact: String = runs.iter().map(|run| run.to_string()).collect();

    println!("{sentence} -> {compact}");
    println!("round trip ok: {}", decode(&runs) == sentence);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips() {
        let original = "wwwwbbbwww";
        assert_eq!(decode(&encode(original)), original);
    }
}
