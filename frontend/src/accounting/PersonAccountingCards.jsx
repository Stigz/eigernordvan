const formatChf = (value) => `CHF ${Number(value || 0).toFixed(2)}`;

const resultText = (row) => {
  if (row.suggestedReceivable > 0) return `Gets reimbursed ${formatChf(row.suggestedReceivable)}`;
  if (row.suggestedDue > 0) return `Still pays ${formatChf(row.suggestedDue)}`;
  return "Balanced for now";
};

function Line({ label, value, strong = false }) {
  return (
    <div className={`person-accounting-line ${strong ? "strong" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function PersonAccountingCards({ model }) {
  return (
    <section className="card full-span person-accounting-section">
      <header>
        <p className="eyebrow">C. People</p>
        <h2>Personal explanation</h2>
        <p className="subtitle">Each card answers: what did I use, what did I owe, what did I already cover, and what is still open?</p>
      </header>
      <div className="person-accounting-grid">
        {model.personRows.map((row) => (
          <article className="person-accounting-card" key={row.person}>
            <header>
              <h3>{row.person}</h3>
              <span className={row.suggestedReceivable > 0 ? "positive" : row.suggestedDue > 0 ? "negative" : ""}>{resultText(row)}</span>
            </header>
            <div className="person-accounting-block">
              <p>Used</p>
              <Line label="Kilometres" value={`${row.km.toFixed(1)} km`} />
              <Line label="Nights" value={row.nights.toFixed(1)} />
            </div>
            <div className="person-accounting-block">
              <p>Charges</p>
              <Line label="Monthly base" value={formatChf(row.monthlyDue)} />
              <Line label="Kilometres" value={formatChf(row.kmCharge)} />
              <Line label="Nights" value={formatChf(row.nightCharge)} />
              <Line label="Work offset" value={`-${formatChf(row.workUsed)}`} />
            </div>
            <div className="person-accounting-block">
              <p>Already paid / credited</p>
              <Line label="Monthly paid" value={formatChf(row.monthlyPaid)} />
              <Line label="Gas / costs paid" value={formatChf(row.privatePaid)} />
              <Line label="Work carried" value={formatChf(row.workCarried)} />
            </div>
            <Line label="Result" value={resultText(row)} strong />
          </article>
        ))}
      </div>
    </section>
  );
}
