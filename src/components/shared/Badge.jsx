const ZON_COLORS = {
  "1": { bg: "#dbeafe", color: "#1e40af" },
  "2": { bg: "#dcfce7", color: "#166534" },
  "3": { bg: "#fef9c3", color: "#854d0e" },
};

const ORSAK_COLORS = {
  "Saldofel":                              { bg: "#fee2e2", color: "#991b1b" },
  "Kontrollavvikelse":                     { bg: "#e0e7ff", color: "#3730a3" },
  "Försent påfylld":                       { bg: "#ffedd5", color: "#9a3412" },
  "Försent påfylld – saldo finns – A-Frame": { bg: "#fef3c7", color: "#92400e" },
  "Saldo fanns – avvikelse ändå":          { bg: "#f3e8ff", color: "#6b21a8" },
  "Utanför min arbetstid":                 { bg: "#f1f5f9", color: "#475569" },
  "Före 08:00":                            { bg: "#f1f5f9", color: "#475569" },
  "Okänd":                                 { bg: "#f1f5f9", color: "#6b7280" },
  "Övrigt":                                { bg: "#f1f5f9", color: "#6b7280" },
};

export function ZonBadge({ zon }) {
  const c = ZON_COLORS[zon] ?? { bg: "#f1f5f9", color: "#6b7280" };
  return (
    <span style={{ ...s.badge, background: c.bg, color: c.color }}>
      Zon {zon}
    </span>
  );
}

export function OrsakBadge({ orsak }) {
  const c = ORSAK_COLORS[orsak] ?? { bg: "#f1f5f9", color: "#6b7280" };
  return (
    <span style={{ ...s.badge, background: c.bg, color: c.color }}>
      {orsak || "—"}
    </span>
  );
}

const s = {
  badge: {
    display: "inline-block",
    padding: "2px 7px",
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 600,
    whiteSpace: "nowrap",
  },
};
