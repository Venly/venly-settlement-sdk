// A deliberately non-compliant screen: raw colour + invented timing copy.
// Committed as a .tsx fixture (invisible to the test tsconfig's .ts include)
// so the CLI's exit-1 path has a real file to fail on.
export function BadScreen() {
  return (
    <div style={{ color: "#ff0000" }}>
      <p>Funds typically arrive within 1-2 business days.</p>
    </div>
  );
}
