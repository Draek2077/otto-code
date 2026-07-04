#!/usr/bin/perl
# Ordered rebrand replacement: Paseo -> Otto / otto-code
# invoke with: perl -CSD rebrand.pl <files...>
# Special rules run BEFORE the generic Paseo/paseo collapse.
use strict; use warnings;
local $/; # slurp
while (my $f = shift @ARGV) {
  open(my $in, '<:encoding(UTF-8)', $f) or do { warn "skip $f: $!"; next; };
  my $s = <$in>; close($in);
  my $orig = $s;
  # --- reverse-DNS bundle identifiers (no hyphens allowed) ---
  $s =~ s/sh\.paseo\.debug/ai.ottocode.debug/g;
  $s =~ s/sh\.paseo\.desktop/ai.ottocode.desktop/g;
  $s =~ s/sh\.paseo/ai.ottocode/g;
  # --- npm scope ---
  $s =~ s/\@getpaseo/\@otto-code/g;
  # --- GitHub org / repo URLs ---
  $s =~ s/getpaseo\/paseo/otto-code-ai\/otto-code/g;
  $s =~ s/getpaseo/otto-code-ai/g;
  # --- marketing domain ---
  $s =~ s/paseo\.sh/otto-code.ai/g;
  # --- env vars ---
  $s =~ s/PASEO_/OTTO_/g;
  # --- generic brand collapse ---
  $s =~ s/Paseo/Otto/g;
  $s =~ s/paseo/otto/g;
  # --- daemon port ---
  $s =~ s/\b6767\b/6868/g;
  if ($s ne $orig) {
    open(my $out, '>:encoding(UTF-8)', $f) or do { warn "write $f: $!"; next; };
    print $out $s; close($out);
    print "changed: $f\n";
  }
}
