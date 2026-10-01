import { useEffect, useRef, useState } from "react";

export function SignaturePad({
  onChange,
  width = 500,
  height = 170,
}: {
  onChange: (dataUrl: string | null) => void;
  width?: number;
  height?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";
  }, []);

  function pos(e: React.PointerEvent) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  }
  function down(e: React.PointerEvent) {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    canvasRef.current!.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext("2d")!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!dirty) setDirty(true);
  }
  function up() {
    drawing.current = false;
    if (dirty) onChange(canvasRef.current!.toDataURL("image/png"));
  }
  function clear() {
    const c = canvasRef.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setDirty(false);
    onChange(null);
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="w-full touch-none rounded-lg border border-line bg-white"
        style={{ aspectRatio: `${width} / ${height}` }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
      />
      <div className="mt-2 flex items-center justify-between text-xs text-muted">
        <span>Draw your signature above</span>
        <button onClick={clear} className="hover:text-brand">
          Clear
        </button>
      </div>
    </div>
  );
}
