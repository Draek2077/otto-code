/// A self-contained Huffman coder.
///
/// Exercises classes, mixins, null safety, sealed classes, pattern matching,
/// collection literals, cascades and named parameters.

import 'dart:collection';

sealed class Node {
  const Node(this.weight);
  final int weight;
}

final class Leaf extends Node {
  const Leaf(this.symbol, super.weight);
  final String symbol;
}

final class Branch extends Node {
  Branch(this.left, this.right) : super(left.weight + right.weight);
  final Node left;
  final Node right;
}

mixin Describable {
  String describe();
}

class Huffman with Describable {
  Huffman(String text) : _text = text {
    _root = _build(_frequencies(text));
    _assign(_root, '');
  }

  final String _text;
  late final Node _root;
  final Map<String, String> _codes = {};

  static Map<String, int> _frequencies(String text) {
    final counts = <String, int>{};
    for (final char in text.split('')) {
      counts.update(char, (value) => value + 1, ifAbsent: () => 1);
    }
    return counts;
  }

  static Node _build(Map<String, int> counts) {
    final queue = SplayTreeMap<String, Node>()
      ..addAll({
        for (final entry in counts.entries)
          '${entry.value.toString().padLeft(6, '0')}${entry.key}': Leaf(entry.key, entry.value),
      });

    while (queue.length > 1) {
      final first = queue.remove(queue.firstKey())!;
      final second = queue.remove(queue.firstKey())!;
      final merged = Branch(first, second);
      queue['${merged.weight.toString().padLeft(6, '0')}~${queue.length}'] = merged;
    }
    return queue.values.first;
  }

  void _assign(Node node, String prefix) => switch (node) {
        Leaf(:final symbol) => _codes[symbol] = prefix.isEmpty ? '0' : prefix,
        Branch(:final left, :final right) => () {
            _assign(left, '${prefix}0');
            _assign(right, '${prefix}1');
          }(),
      };

  String encode() => _text.split('').map((char) => _codes[char] ?? '').join();

  @override
  String describe() {
    final encoded = encode();
    final originalBits = _text.length * 8;
    final ratio = (100 * encoded.length / originalBits).toStringAsFixed(1);
    return 'original $originalBits bits → ${encoded.length} bits ($ratio%)';
  }
}

void main() {
  final coder = Huffman('the tide turns, the light turns with it');
  print(coder.describe());
  print(coder.encode().substring(0, 48) + '…');
}
