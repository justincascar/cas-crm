import { CAS_COMPANY, CAS_HIRE_AGREEMENT_BANNER, CAS_HIRE_TERMS_HTML } from "./cas-hire-terms";
import { OWN_VEHICLE_DETAILS_HEADING } from "./hire-pack-fields";

/**
 * The Storage & Recovery Agreement uses CAS's supplied Hire Pack wording only (review note R17). Nothing here is new
 * terms: the page and the notice of the right to cancel are the Hire Pack pages already printed in the hire agreement,
 * and the terms are the relevant lines of the supplied terms, copied from CAS_HIRE_TERMS_HTML in their original order.
 */

/** Definitions used by the clauses below. Justin confirms the selection in J9a. */
export const STORAGE_RECOVERY_DEFINITION_TERMS = [
  "You, Your",
  "We, Us, Our",
  "Parties",
  "Your Own Vehicle",
  "Accident",
  "Third Party",
  "Recovery",
  "Storage Period",
  "Storage &amp; Recovery Charges",
  "Total Charges",
  "Engineer",
  "Credit Period",
  "Claim",
  "Appointed Representative",
] as const;

/**
 * Clauses that apply when CAS recovers or stores the client's own car without a hire: the storage arrangement (1.1,
 * 1.2, 1.5), payment of the Total Charges on credit (2.1), keeping the Storage Period to a minimum (2.2, 2.3), the end
 * of storage and disposal (2.17, 2.18), the claim and payments (4.1 to 4.6), termination, security and VAT (4.8,
 * 4.10, 4.11), the right to cancel (4.12), and the general clauses (5.1 to 5.8).
 */
export const STORAGE_RECOVERY_CLAUSE_NUMBERS = [
  "1.1", "1.2", "1.5",
  "2.1", "2.2", "2.3", "2.17", "2.18",
  "4.1", "4.2", "4.3", "4.4", "4.5", "4.6", "4.8", "4.10", "4.11", "4.12",
  "5.1", "5.2", "5.3", "5.4", "5.5", "5.6", "5.7", "5.8",
] as const;

const CONFIRMATION_LINES = ["<p>I hereby confirm that I have read and understood", "<p>I also confirm that I was granted"];

function keepLine(line: string): boolean {
  const term = line.match(/^<p><strong>(.+?)<\/strong> — /);
  if (term) return (STORAGE_RECOVERY_DEFINITION_TERMS as readonly string[]).includes(term[1]);
  const clause = line.match(/^<p>(\d+\.\d+) /);
  if (clause) return (STORAGE_RECOVERY_CLAUSE_NUMBERS as readonly string[]).includes(clause[1]);
  return CONFIRMATION_LINES.some((start) => line.startsWith(start));
}

/** The supplied terms, cut down to the definitions and clauses above. Each kept line is the supplied line unchanged. */
export function storageRecoveryTermsHtml(): string {
  const lines = CAS_HIRE_TERMS_HTML.split("\n").map((line) => line.trim()).filter(Boolean);
  const out: string[] = [];
  let pendingHeading: string | null = null;
  for (const line of lines) {
    if (line.startsWith("<h2>")) {
      out.push(line);
    } else if (line.startsWith("<h3>")) {
      pendingHeading = line;
    } else if (keepLine(line)) {
      if (pendingHeading) out.push(pendingHeading);
      pendingHeading = null;
      out.push(line);
    }
  }
  return `\n${out.join("\n")}\n`;
}

/** Values already escaped by the caller. */
export type StorageRecoveryPage = {
  heading: string;
  agreementNumber: string;
  storageGap: string;
  name: string;
  address: string;
  clientMake: string;
  clientModel: string;
  clientRegistration: string;
  /** Shown after the registration on the hire agreement. */
  clientGroup?: string;
  storageRate: string;
  recovery: string;
  /** The recovery charges from the file, on the standalone agreement. */
  chargeLinesHtml?: string;
  mileage: string;
  fuel: string;
  tyres: string;
  damage: string;
};

/** The supplied Storage & Recovery page of the Hire Pack. */
export function storageRecoveryPageHtml(page: StorageRecoveryPage): string {
  return `<section>
<h2>${page.heading}</h2>
<p>${CAS_HIRE_AGREEMENT_BANNER}</p>
<p>Agreement number: <strong>${page.agreementNumber}</strong></p>
<h2>Storage &amp; Recovery Agreement</h2>
${page.storageGap}
<p>Name: ${page.name}<br/>Address: ${page.address}</p>
<h3>${OWN_VEHICLE_DETAILS_HEADING}</h3>
<p>This is the client's own vehicle being recovered and stored, not the hire vehicle.</p>
<p>Make: ${page.clientMake} &nbsp; Model: ${page.clientModel} &nbsp; Vehicle reg: ${page.clientRegistration}${page.clientGroup === undefined ? "" : `<br/>
GTA group: ${page.clientGroup}`}</p>
<p>Storage daily rate: ${page.storageRate} &nbsp; Recovery: ${page.recovery}</p>
${page.chargeLinesHtml ? `${page.chargeLinesHtml}\n` : ""}<p>Mileage: ${page.mileage} &nbsp; Fuel: ${page.fuel}</p>
<p>Tyre depths NSF / OSF / NSR / OSR: ${page.tyres}</p>
<p>Damage: ${page.damage}</p>
<p>I hereby confirm that the damage to the vehicle is marked above and may be supported by digital images taken at the time of collection by Complete Accident Solutions Ltd.</p>
<p>This STORAGE &amp; RECOVERY agreement is bound by the terms outlined in full in the accompanying Terms and Conditions and incur the charges as outlined above upon signing.</p>
<p>Complete Accident Solutions LTD will not accept responsibility for any valuables left in the vehicle at point of collection including removable car stereo and satellite navigation equipment.</p>
<p>Complete Accident Solutions LTD will not accept responsibility for any mechanical defects with the above vehicle whilst in their possession.</p>
<p>Complete Accident Solutions LTD accept responsibility for any PCNs corresponding to the above vehicle incurred between the DATE COLLECTED and DATE RETURNED as recorded above.</p>
<p>In the event that allegations are made against Complete Accident Solutions LTD with regards to damage being incurred to the above vehicle whilst in their possession the damage recorded on this form, digital images taken at the point of collection and return and possible engineering evidence will be used to refute or substantiate the allegations and copies of all paperwork provided to the client.</p>
<p>Signed by Hirer: ______________________</p>
<p>Signed for and on behalf of Complete Accident Solutions Ltd: ______________________</p>
</section>`;
}

/** Values already escaped by the caller. */
export type CancelNotice = {
  heading: string;
  date: string;
  name: string;
  address: string;
  agreementNumber: string;
  generated: string;
};

/** The supplied Notice of the Right to Cancel page of the Hire Pack. */
export function cancelNoticeHtml(notice: CancelNotice): string {
  return `<section>
<h2>${notice.heading}</h2>
<p>${CAS_HIRE_AGREEMENT_BANNER}</p>
<h2>Notice of the Right to Cancel</h2>
<p>Date: ${notice.date}</p>
<p>"The Cancellation of Contracts made in a Consumer's Home or Place of Work etc. Regulations 2008"</p>
<p>Name: ${notice.name}</p>
<p>Address: ${notice.address}</p>
<p>In accordance with the "The Cancellation of Contracts made in a Consumer's Home or Place of Work etc. Regulations 2008" you have the right to cancel the Contract within 14 days from the date as presented on the contract by completing the section below and returning to Complete Accident Solutions Ltd. The 14 day period is determined from the date outlined on the Contract till the date of serving notice of cancellation.</p>
<p>The notice of cancellation will be deemed to be served as soon as it is posted or sent to Complete Accident Solutions Ltd or in the case of an electronic communication from the day it is sent to Complete Accident Solutions Ltd.</p>
<p>Upon safe receipt of the "Notice of the Right to Cancel" document a member of staff from Complete Accident Solutions Ltd will contact you by telephone within 2 hours in order to discuss any provisions already provided by Complete Accident Solutions Ltd which may include a replacement vehicle and or repairs to your vehicle. Cancellation of the contract will then be confirmed in writing and will be provided by hand or post within 24 hours.</p>
<p>Due to factors out of Complete Accident Solutions Ltd and your control with regards to the "Notice of the Right to Cancel" document not being received or received illegible if sent by Post, or Electronic Mail it remains your responsibility to ensure that Complete Accident Solutions Ltd are aware of your instruction to cancel the contract and therefore if you have not received a telephone call from Complete Accident Solutions Ltd within 24 hours if sent by Post or 2 hours if sent by Electronic Mail you are required to contact Complete Accident Solutions Ltd without any delay on (01792) 341069.</p>
<p>If you cancel the Contract within the cancellation period you will immediately become liable to pay for all goods and services that were supplied with the Contract before cancellation.</p>
<p>If the Contract includes the provision for repairs to your vehicle which have either commenced or parts ordered in anticipation of repairs being undertaken you will be responsible to meet any incurred costs and the nominated repairing garage are entitled to exercise Lien on your vehicle until any outstanding charges have been settled by you.</p>
<p>If further explanation or clarification of this document is required please either contact the HIRE ADMINISTRATION department as detailed below or seek independent legal advice.</p>
<p>You are not under any obligation to use the section below but it is your duty to ensure that the notice of cancellation that you send to us conveys your name, address, agreement number, signature and date of signing in order to ensure that it can administered without delay.</p>
<p>Acceptable methods of notifying Complete Accident Solutions Ltd of your intention to cancel the contract are by:</p>
<p>Post: Hire Administration, ${CAS_COMPANY.name}, 171 Cwmgarw Road, Brynamman, Ammanford, SA18 1DG</p>
<p>Electronic mail: ${CAS_COMPANY.email}</p>
<p>If you wish to cancel the contract you MUST DO SO IN WRITING and deliver personally or send (which may be by electronic mail) this to the address below. You may use this form if you want to but you do not have to.</p>
<p>(Complete, detach and return this form ONLY IF YOU WISH TO CANCEL THE CONTRACT.)</p>
<p>TO THE: HIRE ADMINISTRATION DEPARTMENT, COMPLETE ACCIDENT SOLUTIONS LTD, ${CAS_COMPANY.address}</p>
<p>Agreement number: <strong>${notice.agreementNumber}</strong></p>
<p>Name: ${notice.name}</p>
<p>Address: ${notice.address}</p>
<p>Signature: ______________________ Date: ______________</p>
<p>Generated ${notice.generated}. Signatures are not fabricated.</p>
</section>`;
}
