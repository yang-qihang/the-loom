import { fill, chrome } from "../copy";

export function Stars({ stars, max = 3 }: { stars: number; max?: number }) {
  return (
    <span className="stars" role="img" aria-label={fill(chrome.aria.stars, { 数: stars })}>
      {Array.from({ length: max }, (_, index) => (
        <span key={index} className={index < stars ? "star is-filled" : "star"} aria-hidden="true">
          ★
        </span>
      ))}
    </span>
  );
}
