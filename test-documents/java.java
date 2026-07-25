/**
 * A self-contained Caesar/Vigenère cipher pair.
 *
 * Exercises records, sealed interfaces, switch expressions, streams,
 * text blocks, generics and javadoc.
 */
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

public class Cipher {

    /** A key that can shift a single letter. */
    sealed interface Key permits Caesar, Vigenere {
        int shiftFor(int position);
    }

    record Caesar(int shift) implements Key {
        @Override
        public int shiftFor(int position) {
            return shift;
        }
    }

    record Vigenere(String keyword) implements Key {
        @Override
        public int shiftFor(int position) {
            char letter = keyword.charAt(position % keyword.length());
            return Character.toLowerCase(letter) - 'a';
        }
    }

    static String apply(String text, Key key, boolean decrypt) {
        int direction = decrypt ? -1 : 1;
        StringBuilder out = new StringBuilder(text.length());
        int letterIndex = 0;

        for (char ch : text.toCharArray()) {
            if (!Character.isLetter(ch)) {
                out.append(ch);
                continue;
            }
            char base = Character.isUpperCase(ch) ? 'A' : 'a';
            int shift = key.shiftFor(letterIndex++) * direction;
            out.append((char) (base + Math.floorMod(ch - base + shift, 26)));
        }
        return out.toString();
    }

    public static void main(String[] args) {
        String plain = """
            Meet me at the lighthouse.
            Bring the good lantern.""";

        List<Key> keys = List.of(new Caesar(3), new Vigenere("tide"));

        String report = keys.stream()
            .map(key -> {
                String encrypted = apply(plain, key, false);
                String label = switch (key) {
                    case Caesar c -> "Caesar(" + c.shift() + ")";
                    case Vigenere v -> "Vigenere(" + v.keyword() + ")";
                };
                boolean ok = apply(encrypted, key, true).equals(plain);
                return "%-18s round-trip=%s%n%s".formatted(label, ok, encrypted);
            })
            .collect(Collectors.joining("\n\n"));

        System.out.println(report);
        System.out.println();
        System.out.println(IntStream.rangeClosed(1, 5).mapToObj("*"::repeat).collect(Collectors.joining(" ")));
    }
}
