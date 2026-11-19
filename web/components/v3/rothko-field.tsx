"use client";

import { useEffect, useState } from "react";

type Props = {
  className?: string;
  /** Increment to pulse colour blocks (e.g. on each send). */
  pulseKey?: number;
  /** Soft glow framing the message thread. */
  highlightMessages?: boolean;
  /** Soft glow framing the composer. */
  highlightInput?: boolean;
  /** Keep cycling Rothko colours while research / explain is in flight. */
  researching?: boolean;
};

const PALETTE = [
  "#dca10f",
  "#ed5a0b",
  "#ff661c",
  "#ed000f",
  "#f8a125",
  "#3759b3",
  "#49151f",
  "#3c3b63",
  "#608b46",
  "#935a2d",
  "#fb752f",
  "#852816",
  "#f0ac01",
  "#f95a98",
  "#8c0a1e",
  "#f38700",
  "#421f4c",
  "#398aba",
  "#123482",
  "#ee1c19",
  "#e3561d",
  "#f9c139",
];

function pick(): string {
  return PALETTE[Math.floor(Math.random() * PALETTE.length)]!;
}

/**
 * Rothko colour fields behind the chat.
 * Colours stay vivid and static until pulseKey changes (message send),
 * or continuously cycle while researching.
 */
export function RothkoField({
  className,
  pulseKey = 0,
  highlightMessages = true,
  highlightInput = true,
  researching = false,
}: Props) {
  const [outputColor, setOutputColor] = useState("#ed5a0b");
  const [midColor, setMidColor] = useState("#3c3b63");
  const [inputColor, setInputColor] = useState("#3759b3");
  const [bg, setBg] = useState("#fdf8e1");
  const [pulse, setPulse] = useState(false);

  const reshuffle = () => {
    setOutputColor(pick());
    setMidColor(pick());
    setInputColor(pick());
    setBg(pick());
  };

  useEffect(() => {
    if (pulseKey <= 0) return;
    reshuffle();
    setPulse(true);
    const t = window.setTimeout(() => setPulse(false), 900);
    return () => window.clearTimeout(t);
  }, [pulseKey]);

  useEffect(() => {
    if (!researching) {
      setPulse(false);
      return;
    }
    reshuffle();
    setPulse(true);
    const id = window.setInterval(() => {
      reshuffle();
      setPulse(true);
    }, 1400);
    return () => {
      window.clearInterval(id);
      setPulse(false);
    };
  }, [researching]);

  return (
    <div
      className={[
        "ls-rothko",
        "ls-rothko--viewport",
        pulse ? "ls-rothko--pulse" : "",
        researching ? "ls-rothko--researching" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ backgroundColor: bg }}
      aria-hidden="true"
    >
      <div
        className={`ls-rothko__zone ls-rothko__zone--output ${highlightMessages ? "is-on" : ""}`}
        style={{ backgroundColor: outputColor }}
      />
      <div className="ls-rothko__zone ls-rothko__zone--mid" style={{ backgroundColor: midColor }} />
      <div
        className={`ls-rothko__zone ls-rothko__zone--input ${highlightInput ? "is-on" : ""}`}
        style={{ backgroundColor: inputColor }}
      />
    </div>
  );
}
