"""Verify the actual APK/AAB carries the offline model and JNI for every shipped ABI."""
import hashlib
import json
import pathlib
import sys
import zipfile


def verify(archive_path, kind):
    root = pathlib.Path(__file__).resolve().parents[2]
    audio = root / "packages/expo-two-way-audio"
    manifest = json.loads((audio / "wake-word-model.json").read_text())
    prefix = "base/" if kind == "aab" else ""
    with zipfile.ZipFile(archive_path) as archive:
        names = set(archive.namelist())
        for name in manifest["assets"].values():
            data = archive.read(f"{prefix}assets/wake-word/{name}")
            if len(data) != manifest["assetBytes"][name] or hashlib.sha256(data).hexdigest() != manifest["assetSha256"][name]:
                raise ValueError(f"Packaged wake-word asset failed verification: {name}")
        packaged = json.loads(archive.read(f"{prefix}assets/wake-word/model.json"))
        if packaged != manifest:
            raise ValueError("Packaged model provenance differs from reviewed manifest")
        archive.read(f"{prefix}assets/wake-word/LICENSE-APACHE-2.0.txt")
        native_prefix = prefix + "lib/"
        abis = {name[len(native_prefix):].split("/")[0] for name in names if name.startswith(native_prefix) and name.endswith(".so")}
        if not abis:
            raise ValueError("Android artifact has no native ABIs")
        with zipfile.ZipFile(audio / manifest["androidRuntime"]["file"]) as runtime:
            runtime_names = set(runtime.namelist())
            for abi in sorted(abis):
                libraries = [name for name in runtime_names if name.startswith(f"jni/{abi}/") and name.endswith(".so")]
                if not libraries:
                    raise ValueError(f"Pinned detector does not support packaged ABI: {abi}")
                for library in libraries:
                    member = native_prefix + library.removeprefix("jni/")
                    # AGP can strip debug symbols: validate packaged ELF availability,
                    # not byte equality with the checksum-verified input AAR.
                    with archive.open(member) as binary:
                        if binary.read(4) != b"\x7fELF" or archive.getinfo(member).file_size < 1024:
                            raise ValueError(f"Invalid packaged native detector: {member}")
    print(f"Verified Hey Otto assets, provenance, license and native libraries for {', '.join(sorted(abis))}")


if __name__ == "__main__":
    if len(sys.argv) != 3 or sys.argv[2] not in ("apk", "aab"):
        raise SystemExit("usage: verify-wake-android.py artifact apk|aab")
    verify(sys.argv[1], sys.argv[2])
