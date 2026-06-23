// causes.js
// Orsakstaxonomi + ansvarsmappning. Kopierad VERBATIM från AvvikelseLive.html.

export const ORSAKER = [
  "Saldofel",
  "Försent påfylld",
  "Saldo fanns – avvikelse ändå",
  "Försent påfylld – saldo finns – A-Frame",
  "Kontrollavvikelse",
  "Utanför min arbetstid",
  "Före 08:00",
  "Okänd",
  "Övrigt",
];

export const ORSAK_ANSVAR = {
  "Saldofel": "Inventering",
  "Försent påfylld": "Påfyllning",
  "Saldo fanns – avvikelse ändå": "Plockare/System",
  "Försent påfylld – saldo finns – A-Frame": "Påfyllning A-Frame",
  "Kontrollavvikelse": "Plockare",
  "Utanför min arbetstid": "Schemaläggning",
  "Före 08:00": "Schemaläggning",
  "Okänd": "—",
  "Övrigt": "—",
};
