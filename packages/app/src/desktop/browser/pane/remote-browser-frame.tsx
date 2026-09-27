import { Canvas, Image, Skia, type SkImage } from "@shopify/react-native-skia";
import { forwardRef, useImperativeHandle, useMemo, useState } from "react";

export interface RemoteBrowserFrameHandle {
  present(dataBase64: string): Promise<void> | void;
}

interface Props {
  width: number;
  height: number;
  onWheel?: (deltaX: number, deltaY: number) => void;
  onKeyInput?: (value: string, kind: "text" | "key") => void;
}

export const RemoteBrowserFrame = forwardRef<RemoteBrowserFrameHandle, Props>(
  function RemoteBrowserFrame({ width, height }, ref) {
    const [image, setImage] = useState<SkImage | null>(null);
    const canvasStyle = useMemo(() => ({ width, height }), [width, height]);

    useImperativeHandle(ref, () => ({
      present(dataBase64) {
        const encoded = Skia.Data.fromBase64(dataBase64);
        let decoded: SkImage | null;
        try {
          decoded = Skia.Image.MakeImageFromEncoded(encoded);
        } finally {
          encoded.dispose();
        }
        if (!decoded) throw new Error("The host sent a browser frame that could not be decoded.");
        // The previous decoded frame stays mounted until its replacement is ready.
        setImage(decoded);
      },
    }));

    return (
      <Canvas style={canvasStyle}>
        {image ? (
          <Image image={image} fit="contain" x={0} y={0} width={width} height={height} />
        ) : null}
      </Canvas>
    );
  },
);
