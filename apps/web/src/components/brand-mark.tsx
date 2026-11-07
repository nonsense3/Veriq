export function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand" aria-label="Veriq">
      <svg aria-hidden="true" className="brand-mark" viewBox="0 0 32 32">
        <path d="M5 7.5 16 3l11 4.5v7.3c0 7.1-4.5 11.8-11 14.2C9.5 26.6 5 21.9 5 14.8V7.5Z" />
        <path d="m10.5 15.8 3.3 3.3 7.8-8" />
      </svg>
      {!compact && <span>Veriq</span>}
    </span>
  );
}
