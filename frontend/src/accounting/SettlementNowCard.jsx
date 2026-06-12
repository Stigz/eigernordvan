const sharedPotAccount = "shared_pot";

const formatChf = (value) => `CHF ${Number(value || 0).toFixed(2)}`;
const formatSignedChf = (value) => {
  const amount = Number(value || 0);
  return amount < 0 ? `CHF -${Math.abs(amount).toFixed(2)}` : formatChf(amount);
};
const formatParty = (value) => (value === sharedPotAccount ? "Shared pot" : value || "-");

function SettlementRows({ title, emptyText, rows }) {
  return (
    <section className="settlement-now-group">
      <h3>{title}</h3>
      <div className="settlement-action-list">
        {rows.length === 0 ? (
          <p className="empty-card">{emptyText}</p>
        ) : (
          rows.map((row) => (
            <div className="settlement-action-row" key={`${row.from_person}-${row.to_person}-${row.amount_chf}`}>
              <span>{formatParty(row.from_person)}</span>
              <span className="settlement-arrow">-&gt;</span>
              <span>{formatParty(row.to_person)}</span>
              <strong>{formatChf(row.amount_chf)}</strong>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default function SettlementNowCard({ projection, model, periodLabel, controls, status }) {
  const sharedPot = projection.sharedPot || {};
  const dueRows = model.settlementGroups?.dueToSharedPot || [];
  const reimbursementRows = model.settlementGroups?.reimbursementsFromSharedPot || [];
  const totalDue = dueRows.reduce((sum, row) => sum + Number(row.amount_chf || 0), 0);
  const totalReimbursements = reimbursementRows.reduce((sum, row) => sum + Number(row.amount_chf || 0), 0);

  return (
    <section className="card full-span settlement-now-card">
      <header className="settlement-now-header">
        <div>
          <p className="eyebrow">A. Settlement now</p>
          <h1>What must happen now?</h1>
          <p className="subtitle">
            {periodLabel}. After these payments, the account should be balanced for this period.
          </p>
        </div>
        <div className="settlement-now-total">
          <span>Still open</span>
          <strong>{formatSignedChf(totalDue - totalReimbursements)}</strong>
        </div>
      </header>

      {status?.state && status.state !== "idle" && <div className={`status ${status.state}`}>{status.message}</div>}

      <div className="settlement-now-metrics">
        <article>
          <span>Total due into shared pot</span>
          <strong>{formatChf(totalDue)}</strong>
        </article>
        <article>
          <span>Total reimbursements from shared pot</span>
          <strong>{formatChf(totalReimbursements)}</strong>
        </article>
        <article>
          <span>Expected shared pot balance after settlement</span>
          <strong>{formatSignedChf(sharedPot.balance_chf)}</strong>
        </article>
        <article>
          <span>Reserve allocation</span>
          <strong>{formatChf(sharedPot.reserve_allocation_chf)}</strong>
        </article>
        <article>
          <span>Open historical investment, paused</span>
          <strong>{formatChf(projection.historical?.investment_chf)}</strong>
        </article>
        <article>
          <span>Already paid / credited</span>
          <strong>{formatChf(model.totals.recordedPaid + model.totals.totalPrivatePaid)}</strong>
        </article>
      </div>

      <div className="settlement-now-actions">
        <SettlementRows title="Must pay now" emptyText="Nothing still to pay into the shared pot." rows={dueRows} />
        <SettlementRows title="Gets reimbursed" emptyText="No reimbursements from the shared pot right now." rows={reimbursementRows} />
      </div>

      {controls && <div className="settlement-controls">{controls}</div>}
    </section>
  );
}
