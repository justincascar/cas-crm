"use client";

import { useRef, type PointerEvent } from "react";

/** Draws into a hidden field on the ordinary form post. It does not send the form itself. */
export function SignaturePad() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const drawing = useRef(false);

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.width) / rect.width,
      y: ((event.clientY - rect.top) * canvas.height) / rect.height,
    };
  }

  function start(event: PointerEvent<HTMLCanvasElement>) {
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const at = point(event);
    ctx.beginPath();
    ctx.moveTo(at.x, at.y);
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const at = point(event);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#101c24";
    ctx.lineTo(at.x, at.y);
    ctx.stroke();
  }

  function finish() {
    if (!drawing.current) return;
    drawing.current = false;
    const canvas = canvasRef.current;
    if (canvas && hiddenRef.current) hiddenRef.current.value = canvas.toDataURL("image/png");
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (hiddenRef.current) hiddenRef.current.value = "";
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={600}
        height={180}
        aria-label="Signature"
        className="mt-1 w-full touch-none rounded-md border border-line bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      />
      <input ref={hiddenRef} type="hidden" name="signaturePng" />
      <button type="button" className="mt-2 min-h-11 rounded-md border border-line px-3 py-2 text-sm" onClick={clear}>
        Clear signature
      </button>
    </div>
  );
}
