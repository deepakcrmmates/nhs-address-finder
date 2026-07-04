# Make an Offer — parked next steps

Status: **PARKED** (not built). Current live page `make-an-offer.html` covers:
choice → address + offer + type → live HMLR meter check → soft-accept.

The screens below come **after** the meter soft-accept, turning it into a full
multi-step buyer journey (4-step progress bar seen bottom of each screen).

---

## Step 1 of 4 — Applicants Details
Heading: **Applicants Details** · sub: "Please carefully fill out all the details accurately"
- **Full Name of Applicants** — text (both names if buying together)
- **Current Address** — text ("Full Address if applicable") → wire to Ideal Postcodes / OS Places autocomplete
- **Buying Position** — select (e.g. First Time Buyer, Homeowner, SSTC, Cash buyer, BTL…)
- **If SSTC – Name of Estate Agent required** — text (conditional on Buying Position = SSTC)
- CTA: Continue →

## Step 2 of 4 — Applicants Finances
Heading: **Applicants Finances** · sub: "Please fill out the required information below:"
- **Mortgage Required** — select Yes/No
- **Deposit (£) Amount if applicable** — number
- **Do you have a Decision In Principle?** — select Yes/No
- **Upload Decision in Principle** — file drop (png, jpeg, pdf) → Box upload on submit
- CTA: Continue →

## Step 3 of 4 — Submit your Offer Now
Heading: **Submit your Offer Now** · sub: "Once your offer has been submitted we will
then put forward to the vendors for their consideration, we will be back in touch within
2 hours to discuss your offer in more detail – Thank You"
- **First name** / **Last name** — text (side by side)
- **Consent checkbox** — "I agree to be contacted by New Home Solutions on the contact
  details provided for the purpose of discussing my offer." (required)
- **Email address** — email (mail icon)
- **Phone** — intl phone input, default GB (+44)
- CTA: Continue →

## Step 4 of 4 — Solicitor / Conveyancing
Heading: **Solicitor / Conveyancing** · sub: "To purchase a house you will need to instruct
a solicitor, please follow the instructions below:"
- Body: "A good solicitor is of upmost importance, please see the below exclusive
  Conveyancing Quote from one of our preferred panelled solicitors"
- Quote callout: **£1375 – ALL INCLUSIVE** (pull from NHS_API_Config Standard fee? — confirm)
- **Please confirm if you would like to use our panel solicitors** — select Yes/No
- CTA: **Submit** (paper-plane icon) → final thank-you

---

## Open decisions before building
- Where the offer lands: POST to Salesforce (create Offer/Lead + link property) via a new
  Vercel Edge Function. DIP file → Box.
- £1375 quote: hard-coded or config-driven?
- Progress bar: 4 steps as shown — decide whether the meter/soft-accept counts as step 0
  or sits before the bar.
- Conditional "estate agent" field only when Buying Position = SSTC.
- Consent + phone/email = the GDPR/contact capture; must be stored with the offer.