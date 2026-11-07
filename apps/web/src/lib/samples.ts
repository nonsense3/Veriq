/** Synthetic examples for demonstrations. None of these contain real personal data. */
export const SAMPLE_URLS = [
  { label: "Benign HTTPS site", value: "https://example.com" },
  { label: "PayPal lookalike", value: "http://paypa1-secure-login.com/account/verify" },
  { label: "Bank KYC lookalike", value: "https://sbi-kyc-update.in/verify" },
  { label: "Compromised CA test host", value: "https://dv-g3b-emudhra.we-have-a-problem.com/" },
];

export const SAMPLE_MESSAGES = [
  {
    label: "Recruitment scam",
    sender: "",
    text: "Congratulations! You are selected for a part-time job. Earn Rs 5000 per day from home, no experience required. Pay a refundable registration fee of Rs 999 to UPI hr.desk22@ybl today to receive your offer letter.",
  },
  {
    label: "Bank KYC phishing",
    sender: "alerts@sbi-kyc-help.in",
    text: "Dear Customer, your SBI account will be BLOCKED within 24 hours due to pending KYC. Update KYC immediately at https://sbi-kyc-update.in/verify and share the OTP sent to your mobile to confirm. - SBI Team",
  },
  {
    label: "Benign urgent notice",
    sender: "",
    text: "Reminder: your electricity bill is due tomorrow. Pay before the due date to avoid a late fee. You can pay in the official app or at the service centre. Never share your OTP or PIN with anyone.",
  },
];
