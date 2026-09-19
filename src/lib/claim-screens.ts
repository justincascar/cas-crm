export type FieldType = "text" | "textarea" | "date" | "time" | "gbp" | "number" | "checkbox" | "select";

export type ScreenField = {
  name: string;
  label: string;
  type?: FieldType;
  options?: Array<{ value: string; label: string }>;
  span?: 1 | 2;
  hint?: string;
};

export type ScreenSection = {
  title?: string;
  fields: ScreenField[];
};

export type ClaimScreenDef = {
  key: string;
  label: string;
  group: "comms" | "case" | "hire" | "works" | "recovery" | "money";
  hint?: string;
  hidden?: boolean;
  sections: ScreenSection[];
};

const yesNo = [
  { value: "", label: "Unknown" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export const CLAIM_SCREEN_GROUPS = [
  { key: "comms", label: "Communications" },
  { key: "case", label: "Case" },
  { key: "hire", label: "Hire" },
  { key: "works", label: "Engineering / repairs" },
  { key: "recovery", label: "Recovery / storage" },
  { key: "money", label: "Money" },
] as const;

export const CLAIM_SCREENS: ClaimScreenDef[] = [
  {
    key: "comms",
    label: "Email, WhatsApp, calls and documents",
    group: "comms",
    hint: "Send and file email, WhatsApp and calls on this file. Generate letters from the dates already recorded. Live mailbox, WhatsApp Business and telephony are not connected yet.",
    sections: [],
  },
  {
    key: "general",
    label: "General details",
    group: "case",
    hint: "File identity, accident headline and who is involved. Liability status and roadworthiness are staff choices — neither defaults to Fault or Roadworthy.",
    sections: [
      {
        fields: [
          { name: "claimTypeRta", label: "Claim type", type: "select", options: [
            { value: "rta", label: "RTA" },
            { value: "other", label: "Other" },
          ]},
          { name: "caseStatus", label: "Case status" },
          { name: "howInvolved", label: "How involved", type: "select", options: [
            { value: "", label: "Unknown" },
            { value: "owner", label: "Owner" },
            { value: "driver", label: "Driver" },
            { value: "owner_driver", label: "Owner/driver" },
            { value: "passenger", label: "Passenger" },
          ]},
          { name: "liabilityAdmitted", label: "Liability admitted", type: "select", options: yesNo },
          { name: "vatRegistered", label: "VAT registered", type: "checkbox" },
          { name: "typeOfClaim", label: "Liability status", type: "select", options: [
            { value: "", label: "Not yet decided" },
            { value: "non_fault", label: "Non-fault" },
            { value: "fault", label: "Fault" },
            { value: "disputed", label: "Disputed / unclear" },
          ], hint: "Staff working view of this file. Independent of roadworthiness. Disputed / unclear is a valid answer." },
          { name: "roadworthiness", label: "Roadworthiness", type: "select", options: [
            { value: "", label: "Not yet decided" },
            { value: "roadworthy", label: "Roadworthy" },
            { value: "unroadworthy", label: "Unroadworthy" },
          ], hint: "Staff working view of the client's vehicle. Independent of liability status. Do not guess." },
          { name: "ourPolicy", label: "Our policy / source" },
          { name: "oldCaseReference", label: "Old case reference" },
          { name: "linkedCase", label: "Linked case" },
          { name: "subAgent", label: "Sub agent" },
        ],
      },
    ],
  },
  {
    key: "client",
    label: "Client details",
    group: "case",
    sections: [
      {
        fields: [
          { name: "title", label: "Title", type: "select", options: [
            { value: "", label: "Leave blank" },
            { value: "Mr", label: "Mr" },
            { value: "Mrs", label: "Mrs" },
            { value: "Miss", label: "Miss" },
            { value: "Master", label: "Master" },
          ]},
          { name: "forename", label: "Forename" },
          { name: "surname", label: "Surname" },
          { name: "address", label: "Address", type: "textarea", span: 2 },
          { name: "postcode", label: "Postcode" },
          { name: "telMain", label: "Tel main" },
          { name: "telHome", label: "Tel home" },
          { name: "telMobile", label: "Tel mobile" },
          { name: "email", label: "Email" },
          { name: "dob", label: "Date of birth", type: "date" },
          { name: "occupation", label: "Occupation" },
          { name: "niNumber", label: "NI number (restricted)" },
          { name: "licenceNumber", label: "Driving licence no. (restricted)" },
          { name: "licenceIssuedOn", label: "Issued on", type: "date" },
          { name: "licenceExpiry", label: "Expiry date", type: "date" },
          { name: "licenceHeldYears", label: "Licence held (years)", type: "number" },
          { name: "issuingCountry", label: "Issuing country" },
          { name: "drivingTestDate", label: "Date of driving test", type: "date" },
          { name: "salutation", label: "Salutation for letters", hint: "Example: Dear Sirs" },
          { name: "convictions", label: "Motor/criminal convictions in last 5 years", type: "textarea", span: 2 },
          { name: "correspondenceByEmail", label: "All correspondence to be sent by email", type: "checkbox", span: 2 },
        ],
      },
    ],
  },
  {
    key: "driver",
    label: "Client driver details",
    group: "case",
    hint: "Used when the driver is not the same person as the client.",
    sections: [
      {
        fields: [
          { name: "title", label: "Title" },
          { name: "forename", label: "Forename" },
          { name: "surname", label: "Surname" },
          { name: "dob", label: "Date of birth", type: "date" },
          { name: "address", label: "Address", type: "textarea", span: 2 },
          { name: "postcode", label: "Postcode" },
          { name: "telMain", label: "Tel main" },
          { name: "telMobile", label: "Tel mobile" },
          { name: "email", label: "Email" },
          { name: "drivingTestDate", label: "Date driving test passed", type: "date" },
          { name: "previousAccidents", label: "Previous accidents?", type: "select", options: yesNo },
          { name: "previousConvictions", label: "Previous convictions?", type: "select", options: yesNo },
          { name: "previousAccidentDate", label: "Previous accident date", type: "date" },
          { name: "previousConvictionsDate", label: "Previous convictions date", type: "date" },
        ],
      },
    ],
  },
  {
    key: "owner",
    label: "Vehicle owner",
    group: "case",
    sections: [
      {
        fields: [
          { name: "companyName", label: "Company / name" },
          { name: "address", label: "Address", type: "textarea", span: 2 },
          { name: "postcode", label: "Postcode" },
          { name: "telMain", label: "Tel main" },
          { name: "email", label: "Email" },
          { name: "contact", label: "Contact" },
        ],
      },
    ],
  },
  {
    key: "insurer",
    label: "Client insurer",
    group: "case",
    sections: [
      {
        fields: [
          { name: "companyName", label: "Company name" },
          { name: "address", label: "Address", type: "textarea", span: 2 },
          { name: "postcode", label: "Postcode" },
          { name: "telMain", label: "Tel main" },
          { name: "email", label: "Email" },
          { name: "claimReference", label: "Claim reference" },
          { name: "policyNumber", label: "Policy number" },
          { name: "audatexNetworkCode", label: "Audatex network code", hint: "Only once the insurer has confirmed it. Leave blank until then. If another file for this insurer already has a code, it is pre-filled as a suggestion — overwrite if this file is different." },
          { name: "audatexWorkProviderCode", label: "Audatex work provider code", hint: "Only once the insurer has confirmed it. Leave blank until then. If another file for this insurer already has a code, it is pre-filled as a suggestion — overwrite if this file is different." },
          { name: "cover", label: "Cover" },
          { name: "amountPaidToUs", label: "Amount paid to us", type: "gbp" },
          { name: "amountReceived", label: "Amount received", type: "gbp" },
        ],
      },
    ],
  },
  {
    key: "vehicle",
    label: "Vehicle details",
    group: "case",
    hint: "Registration lookup does not identify the keeper. Gearbox is not guessed.",
    sections: [
      {
        title: "Client vehicle",
        fields: [
          { name: "clientMake", label: "Make" },
          { name: "clientModel", label: "Model" },
          { name: "clientReg", label: "Registration" },
          { name: "clientColour", label: "Colour" },
          { name: "clientLocation1", label: "Vehicle location line 1", span: 2 },
          { name: "clientLocationPostcode", label: "Location postcode" },
        ],
      },
      {
        title: "Third-party vehicle",
        fields: [
          { name: "tpMake", label: "Make" },
          { name: "tpModel", label: "Model" },
          { name: "tpReg", label: "Registration" },
          { name: "tpColour", label: "Colour" },
        ],
      },
    ],
  },
  {
    key: "damage",
    label: "Vehicle damage",
    group: "case",
    hint: "Mark panels on the diagram. AI does not certify roadworthiness.",
    sections: [
      {
        title: "Initial assessment",
        fields: [
          { name: "stopNotice", label: "Stop notice (taxis only)", type: "checkbox" },
          { name: "writeOff", label: "Write off?", type: "checkbox" },
          { name: "legallyDriveable", label: "Legally driveable?", type: "checkbox" },
          { name: "repairable", label: "Repairable?", type: "checkbox" },
          { name: "estimatedRepairDays", label: "Estimated days for repair", type: "number" },
        ],
      },
    ],
  },
  {
    key: "accident",
    label: "Accident details",
    group: "case",
    hint: "Ask whether photographs were taken at the scene. If they were, the client can be asked to send them in via WhatsApp. Live WhatsApp is not connected yet.",
    sections: [
      {
        fields: [
          { name: "accidentDate", label: "Date", type: "date" },
          { name: "accidentTime", label: "Time", type: "time" },
          { name: "weather", label: "Weather conditions" },
          { name: "location", label: "Location", span: 2 },
          { name: "details", label: "Details", type: "textarea", span: 2 },
          { name: "photosAtScene", label: "Were any photographs taken at the scene?", type: "select", options: yesNo, span: 2 },
          { name: "injured", label: "Injured?" },
          { name: "injuries", label: "Injuries", type: "textarea", span: 2 },
          { name: "witnessesPolice", label: "Witnesses / police", type: "textarea", span: 2 },
          { name: "losses", label: "Losses", type: "textarea", span: 2 },
          { name: "purpose", label: "Purpose of journey", span: 2 },
          { name: "clientSpeed", label: "Speed of client vehicle" },
          { name: "tpSpeed", label: "Speed of third-party vehicle" },
        ],
      },
    ],
  },
  {
    key: "witnesses",
    label: "Witnesses",
    group: "case",
    sections: [
      {
        title: "Witness 1",
        fields: [
          { name: "title", label: "Title" },
          { name: "forename", label: "Forename" },
          { name: "surname", label: "Surname" },
          { name: "address", label: "Address", type: "textarea", span: 2 },
          { name: "postcode", label: "Postcode" },
          { name: "telMain", label: "Tel main" },
          { name: "telMobile", label: "Tel mobile" },
          { name: "email", label: "Email" },
          { name: "salutation", label: "Salutation" },
          { name: "questionnaireSent", label: "Questionnaire sent", type: "date" },
          { name: "questionnaireReceived", label: "Questionnaire received", type: "date" },
        ],
      },
    ],
  },
  {
    key: "tp1",
    label: "Third party 1",
    group: "case",
    hint: "Start typing the insurer or TPI agent name. Shared telephone, email and address fill from names already used. Policy numbers, claim references and agent references are not filled in.",
    sections: [
      {
        title: "TP personal details",
        fields: [
          { name: "title", label: "Title" },
          { name: "forename", label: "Forename" },
          { name: "surname", label: "Surname" },
          { name: "address", label: "Address", type: "textarea", span: 2 },
          { name: "postcode", label: "Postcode" },
          { name: "telMain", label: "Tel main" },
          { name: "email", label: "Email" },
        ],
      },
      {
        title: "TP vehicle",
        fields: [
          { name: "registration", label: "Registration" },
          { name: "make", label: "Make" },
          { name: "model", label: "Model" },
        ],
      },
      {
        title: "TP insurance",
        fields: [
          { name: "insurerName", label: "Name" },
          { name: "insurerAddress", label: "Address", type: "textarea", span: 2 },
          { name: "insurerPostcode", label: "Postcode" },
          { name: "insurerTel", label: "Tel main" },
          { name: "insurerEmail", label: "Email" },
          { name: "insurerReference", label: "Reference" },
          { name: "policyNumber", label: "Policy no." },
          { name: "liabilityDeclared", label: "Liability declared", type: "select", options: [
            { value: "", label: "Unknown" },
            { value: "admitted", label: "Admitted" },
            { value: "denied", label: "Denied" },
            { value: "pending", label: "Pending" },
          ]},
        ],
      },
      {
        title: "TP insurer agent",
        fields: [
          { name: "agentName", label: "Name" },
          { name: "agentAddress", label: "Address", type: "textarea", span: 2 },
          { name: "agentPostcode", label: "Postcode" },
          { name: "agentTel", label: "Tel main" },
          { name: "agentEmail", label: "Email" },
          { name: "agentHandlerName", label: "Handler name" },
          { name: "agentHandlerEmail", label: "Handler email" },
          { name: "agentHandlerTel", label: "Handler telephone" },
          { name: "agentReference", label: "Reference" },
        ],
      },
    ],
  },
  {
    key: "tp2",
    label: "Third party 2",
    group: "case",
    sections: [
      {
        fields: [
          { name: "forename", label: "Forename" },
          { name: "surname", label: "Surname" },
          { name: "registration", label: "Registration" },
          { name: "make", label: "Make" },
          { name: "model", label: "Model" },
          { name: "insurerName", label: "Insurer" },
          { name: "insurerReference", label: "Reference" },
        ],
      },
    ],
  },
  {
    key: "hire-vehicle",
    label: "Hire vehicle",
    group: "hire",
    hint: "Allocate from fleet or record a cross-hire. Reservation does not start charges.",
    sections: [],
  },
  {
    key: "reserve",
    label: "Reserve hire vehicle",
    group: "hire",
    hint: "Reserve a vehicle that is currently on hire. Overlaps are blocked.",
    sections: [],
  },
  {
    key: "navigation",
    label: "Navigation",
    group: "case",
    hidden: true,
    sections: [],
  },
  {
    key: "history",
    label: "History",
    group: "case",
    hidden: true,
    sections: [],
  },
  {
    key: "hire-mitigation",
    label: "Hire / Mitigation",
    group: "hire",
    hint: "Need for hire is recorded here. Opening a file or reserving a vehicle does not start charges.",
    sections: [
      {
        fields: [
          { name: "clientReg", label: "Client registration" },
          { name: "gearbox", label: "Gearbox", type: "select", options: [
            { value: "unknown", label: "Unknown — do not guess" },
            { value: "manual", label: "Manual" },
            { value: "automatic", label: "Automatic" },
          ]},
          { name: "engineSize", label: "Engine size" },
          { name: "fuelType", label: "Fuel type" },
          { name: "abiGroup", label: "ABI vehicle group" },
          { name: "fee", label: "Fee", type: "gbp" },
          { name: "tpOfferReceived", label: "Offer of a vehicle from the third-party insurer?", type: "checkbox", span: 2 },
          { name: "offerRejectedReason", label: "If an offer was received, why was it rejected?", type: "textarea", span: 2 },
          { name: "needReason", label: "Why do you need a hire vehicle?", type: "textarea", span: 2 },
        ],
      },
    ],
  },
  {
    key: "delivery-collection",
    label: "Delivery / collection",
    group: "hire",
    sections: [
      {
        title: "Hire period",
        fields: [
          { name: "hireStartDate", label: "Hire start date", type: "date" },
          { name: "hireEndDate", label: "Hire end date", type: "date" },
          { name: "currentHireStatus", label: "Current hire status" },
        ],
      },
      {
        title: "Delivery",
        fields: [
          { name: "deliveryDate", label: "Date", type: "date" },
          { name: "deliveryTime", label: "Time", type: "time" },
          { name: "deliveryDriver", label: "Delivery driver" },
          { name: "deliveryTown", label: "Delivery town", type: "textarea", span: 2 },
        ],
      },
      {
        title: "Collection",
        fields: [
          { name: "collectionDate", label: "Date", type: "date" },
          { name: "collectionTime", label: "Time", type: "time" },
          { name: "collectionDriver", label: "Collection driver" },
          { name: "collectionTown", label: "Collection town", type: "textarea", span: 2 },
        ],
      },
    ],
  },
  {
    key: "hire-details",
    label: "Hire details",
    group: "hire",
    hint: "Enter actual rates. Do not add extras automatically.",
    sections: [
      {
        fields: [
          { name: "hireVehicleCategory", label: "Hire vehicle category" },
          { name: "actualVehicleCategory", label: "Actual vehicle category" },
          { name: "adminCharge", label: "Hire admin charge", type: "gbp" },
          { name: "deliveryAndCollection", label: "Delivery and collection" },
          { name: "hireChargePerDay", label: "Hire charge per day", type: "gbp" },
          { name: "extraChargesPerDay", label: "Extra charges per day", type: "gbp" },
          { name: "outAt", label: "Out" },
          { name: "outAmPm", label: "Out AM/PM", type: "select", options: [
            { value: "", label: "—" },
            { value: "am", label: "AM" },
            { value: "pm", label: "PM" },
          ]},
          { name: "hireBackAt", label: "Hire back" },
          { name: "hireBackAmPm", label: "Hire back AM/PM", type: "select", options: [
            { value: "", label: "—" },
            { value: "am", label: "AM" },
            { value: "pm", label: "PM" },
          ]},
          { name: "netHireCharge", label: "NET hire charge", type: "gbp" },
          { name: "crossHireCostIncVat", label: "Cross hire cost inc VAT", type: "gbp" },
          { name: "totalHireCharges", label: "Total hire charges", type: "gbp" },
          { name: "invoicePaid", label: "Invoice paid", type: "gbp" },
          { name: "numberOfDaysHire", label: "Number of days hire", type: "number" },
          { name: "currentVehicleRef", label: "Current hire vehicle ref" },
          { name: "currentVehicleReg", label: "Reg" },
          { name: "currentVehicleMake", label: "Make" },
          { name: "currentVehicleModel", label: "Model" },
        ],
      },
    ],
  },
  {
    key: "extra-charges",
    label: "Additional hire charges",
    group: "hire",
    hidden: true,
    hint: "Tick only extras that apply. Blue-dot items are non-standard daily rates to enter by hand.",
    sections: [
      {
        title: "Chargeable",
        fields: [
          { name: "adminCharge", label: "Hire admin charge", type: "gbp" },
          { name: "standardPerDay", label: "Standard £ per day", type: "gbp" },
          { name: "automatic", label: "Automatic", type: "checkbox" },
          { name: "automaticRate", label: "Automatic rate", type: "gbp" },
          { name: "estate", label: "Estate", type: "checkbox" },
          { name: "estateRate", label: "Estate rate", type: "gbp" },
          { name: "towBar", label: "Tow bar", type: "checkbox" },
          { name: "towBarRate", label: "Tow bar rate", type: "gbp" },
          { name: "dualControl", label: "Dual control", type: "checkbox" },
          { name: "dualControlRate", label: "Dual control rate", type: "gbp" },
          { name: "gps", label: "GPS", type: "checkbox" },
          { name: "gpsRate", label: "GPS rate", type: "gbp" },
          { name: "handsFree", label: "Hands free", type: "checkbox" },
          { name: "handsFreeRate", label: "Hands free rate", type: "gbp" },
          { name: "otherExtra", label: "Other", type: "checkbox" },
          { name: "otherRate", label: "Other rate", type: "gbp" },
          { name: "extraDriverCharge", label: "Extra driver charge", type: "gbp" },
          { name: "cdw", label: "Collision damage waiver", type: "gbp" },
          { name: "insurance", label: "Insurance", type: "gbp" },
          { name: "ipt", label: "Insurance premium tax", type: "gbp" },
        ],
      },
      {
        title: "Non-chargeable",
        fields: [
          { name: "meter", label: "Meter", type: "checkbox" },
          { name: "topLight", label: "Top light", type: "checkbox" },
          { name: "forHireSign", label: "For hire sign", type: "checkbox" },
          { name: "plate", label: "Plate", type: "checkbox" },
          { name: "fireExtinguisher", label: "Fire extinguisher", type: "checkbox" },
          { name: "firstAidKit", label: "First aid kit", type: "checkbox" },
          { name: "nonChargeableDescription", label: "Description", type: "textarea", span: 2 },
          { name: "miscNotes", label: "Misc hire notes", type: "textarea", span: 2 },
        ],
      },
    ],
  },
  {
    key: "additional-drivers",
    label: "Additional drivers",
    group: "hire",
    sections: [
      {
        title: "Additional driver 1",
        fields: [
          { name: "d1Name", label: "Full name" },
          { name: "d1Address", label: "Address", type: "textarea", span: 2 },
          { name: "d1Postcode", label: "Postcode" },
          { name: "d1TelMain", label: "Tel main" },
          { name: "d1TelMobile", label: "Tel mobile" },
          { name: "d1Email", label: "Email" },
          { name: "d1Occupation", label: "Occupation" },
          { name: "d1Dob", label: "Date of birth", type: "date" },
          { name: "d1TestDate", label: "Date of test", type: "date" },
          { name: "d1LicenceIssued", label: "Issued on", type: "date" },
          { name: "d1LicenceExpiry", label: "Expiry date", type: "date" },
          { name: "d1LicenceNumber", label: "Licence number (restricted)" },
          { name: "d1IssuingCountry", label: "Issuing country" },
        ],
      },
      {
        title: "Additional driver 2",
        fields: [
          { name: "d2Name", label: "Full name" },
          { name: "d2Address", label: "Address", type: "textarea", span: 2 },
          { name: "d2Postcode", label: "Postcode" },
          { name: "d2TelMain", label: "Tel main" },
          { name: "d2TelMobile", label: "Tel mobile" },
          { name: "d2Email", label: "Email" },
          { name: "d2Occupation", label: "Occupation" },
          { name: "d2Dob", label: "Date of birth", type: "date" },
          { name: "d2LicenceNumber", label: "Licence number (restricted)" },
        ],
      },
    ],
  },
  {
    key: "hire-cars",
    label: "Hire cars — details",
    group: "hire",
    hidden: true,
    sections: [
      {
        fields: [
          { name: "hireCoRef", label: "Hire co ref" },
          { name: "registration", label: "Hire vehicle registration" },
          { name: "make", label: "Make" },
          { name: "model", label: "Model" },
          { name: "description", label: "Hire car description" },
          { name: "insCompany", label: "Insurance company" },
          { name: "insPolicyNo", label: "Insurance policy no." },
          { name: "insStart", label: "Insurance start", type: "date" },
          { name: "insFinish", label: "Insurance finish", type: "date" },
          { name: "dateOfRegistration", label: "Date of registration", type: "date" },
          { name: "motDue", label: "MOT due date", type: "date" },
          { name: "serviceDue", label: "Service due date", type: "date" },
          { name: "abiGroup", label: "ABI charge group" },
          { name: "engineSize", label: "Engine size" },
          { name: "costValue", label: "Cost value", type: "gbp" },
          { name: "taxDue", label: "Tax due date", type: "date" },
          { name: "warrantyEnd", label: "Warranty end date", type: "date" },
          { name: "dailyFinanceCost", label: "Daily finance cost", type: "gbp" },
          { name: "transmission", label: "Transmission" },
          { name: "fuel", label: "Fuel" },
          { name: "notes", label: "Notes", type: "textarea", span: 2 },
        ],
      },
    ],
  },
  {
    key: "assessed-damage",
    label: "Assessed damage",
    group: "works",
    hint: "Staff-verified figures from the engineer. Offers are not receipts.",
    sections: [
      {
        fields: [
          { name: "totalLoss", label: "Total loss", type: "checkbox" },
          { name: "assessedRepair", label: "Assessed repair", type: "checkbox" },
          { name: "salvageCategory", label: "Salvage category" },
          { name: "salvageValue", label: "Salvage value", type: "gbp" },
          { name: "grossValuation", label: "Gross valuation", type: "gbp" },
          { name: "netValuation", label: "Net valuation", type: "gbp" },
          { name: "repairHours", label: "Assessed repair hours", type: "number" },
          { name: "hourlyRate", label: "Assessed repair hourly rate", type: "gbp" },
          { name: "labour", label: "Total labour", type: "gbp" },
          { name: "parts", label: "Parts", type: "gbp" },
          { name: "paintMaterials", label: "Paint / materials", type: "gbp" },
          { name: "specialist", label: "Specialist", type: "gbp" },
          { name: "subtotal", label: "Subtotal", type: "gbp" },
          { name: "vat", label: "VAT", type: "gbp" },
          { name: "totalReserve", label: "Total reserve", type: "gbp" },
        ],
      },
    ],
  },
  {
    key: "loss-of-use",
    label: "Loss of use dates",
    group: "works",
    hidden: true,
    hint: "These dates also feed letters. Missing dates stay unknown.",
    sections: [
      {
        fields: [
          { name: "mitStatReturned", label: "MIT / statement of truth returned", type: "date" },
          { name: "firstNotificationTpi", label: "1st notification to TPI", type: "date" },
          { name: "solicitorInstructed", label: "Date solicitor instructed", type: "date" },
          { name: "engineerInstructed", label: "Engineer instructed", type: "date" },
          { name: "engineerInvoicePaid", label: "Engineer invoice paid", type: "date" },
          { name: "repairAuthorised", label: "Repair authorised", type: "date" },
          { name: "repairerInstructed", label: "Repairer instructed", type: "date" },
          { name: "repairStart", label: "Repair start date", type: "date" },
          { name: "repairerInvoicePaid", label: "Repairer invoice paid", type: "date" },
          { name: "abiHirePackTpi", label: "ABI hire pack to TPI", type: "date" },
          { name: "nonAbiHirePackTpi", label: "Non-ABI hire pack to TPI", type: "date" },
          { name: "hirePaidInFull", label: "Hire paid in full", type: "date" },
          { name: "hirerInstructed", label: "Hirer instructed", type: "date" },
          { name: "hireOut", label: "Hire out", type: "date" },
          { name: "hireBack", label: "Hire back", type: "date" },
          { name: "currentHireStatus", label: "Current hire status" },
          { name: "caseStatus", label: "Case status" },
          { name: "daysBeforeTpiPayment", label: "No of days before TPI payment", type: "number" },
        ],
      },
    ],
  },
  {
    key: "storage",
    label: "Storage",
    group: "recovery",
    hint: "Storage billing end is an explicit date. Days are not invented without start and end.",
    sections: [
      {
        fields: [
          { name: "name", label: "Name" },
          { name: "address", label: "Address", type: "textarea", span: 2 },
          { name: "postcode", label: "Postcode" },
          { name: "telMain", label: "Tel main" },
          { name: "email", label: "Email" },
          { name: "ref", label: "Ref" },
          { name: "invoiceNo", label: "Invoice no." },
          { name: "startDate", label: "Storage start date", type: "date" },
          { name: "endDate", label: "Storage end date", type: "date" },
          { name: "dailyRate", label: "Storage daily rate", type: "gbp" },
          { name: "days", label: "Storage days", type: "number" },
          { name: "netAmount", label: "Net amount", type: "gbp" },
          { name: "vat", label: "VAT", type: "gbp" },
          { name: "total", label: "Total", type: "gbp" },
        ],
      },
    ],
  },
  {
    key: "recovery",
    label: "Recovery",
    group: "recovery",
    sections: [
      {
        fields: [
          { name: "name", label: "Name" },
          { name: "address", label: "Address", type: "textarea", span: 2 },
          { name: "postcode", label: "Postcode" },
          { name: "telMain", label: "Tel main" },
          { name: "email", label: "Email" },
          { name: "ref", label: "Ref" },
          { name: "invoiceNo", label: "Invoice no." },
          { name: "location", label: "Recovery location", type: "textarea", span: 2 },
          { name: "recoveryDate", label: "Recovery date", type: "date" },
          { name: "outOfHours", label: "Out of hours", type: "checkbox" },
          { name: "environment", label: "Environment", type: "checkbox" },
          { name: "winch", label: "Winch", type: "checkbox" },
          { name: "priorFeeIncurred", label: "Prior fee incurred / inherited", type: "gbp" },
          { name: "reasonForFee", label: "Reason for fee" },
          { name: "vehicleRole", label: "Vehicle role", type: "checkbox" },
          { name: "vehicleDrive", label: "Vehicle drive", type: "checkbox" },
          { name: "personalBelongings", label: "Personal belongings collected by client", type: "checkbox" },
          { name: "typeRecovered", label: "Type of vehicle recovered" },
          { name: "standardCharge", label: "Standard recovery charge", type: "gbp" },
          { name: "vat", label: "VAT", type: "gbp" },
          { name: "total", label: "Total", type: "gbp" },
        ],
      },
    ],
  },
  {
    key: "financial-summary",
    label: "Financial summary / interim payments",
    group: "money",
    hint: "Invoice amount, received and outstanding are kept separate. An offer is not a payment.",
    sections: [
      {
        title: "Invoices raised",
        fields: [
          { name: "hireInvoice", label: "Hire invoice", type: "gbp" },
          { name: "engineerInvoice", label: "Engineer invoice", type: "gbp" },
          { name: "repairInvoice", label: "Repair invoice", type: "gbp" },
          { name: "policeInvoice", label: "Police invoice", type: "gbp" },
          { name: "recoveryInvoice", label: "Recovery invoice", type: "gbp" },
          { name: "storageInvoice", label: "Storage invoice", type: "gbp" },
          { name: "photographerInvoice", label: "Photographer invoice", type: "gbp" },
        ],
      },
      {
        title: "Payments received",
        fields: [
          { name: "invoiceReceived", label: "Invoice payments received", type: "gbp" },
          { name: "storageReceived", label: "Storage payments received", type: "gbp" },
          { name: "recoveryReceived", label: "Recovery payments received", type: "gbp" },
          { name: "invoiceWriteOff", label: "Invoice write-off", type: "gbp" },
          { name: "storageWriteOff", label: "Storage write-off", type: "gbp" },
          { name: "recoveryWriteOff", label: "Recovery write-off", type: "gbp" },
        ],
      },
    ],
  },
];

export function getClaimScreen(key: string) {
  return CLAIM_SCREENS.find((s) => s.key === key) || null;
}

export function screensByGroup() {
  return CLAIM_SCREEN_GROUPS.map((group) => ({
    ...group,
    screens: CLAIM_SCREENS.filter((s) => s.group === group.key && !s.hidden),
  })).filter((group) => group.screens.length > 0);
}

export const DAMAGE_PANELS = [
  { key: "offside_front", label: "Offside front", row: "offside", col: 1 },
  { key: "offside", label: "Offside", row: "offside", col: 2 },
  { key: "offside_rear", label: "Offside rear", row: "offside", col: 3 },
  { key: "front", label: "Front", row: "mid", col: 0 },
  { key: "rear", label: "Rear", row: "mid", col: 4 },
  { key: "nearside_front", label: "Nearside front", row: "nearside", col: 1 },
  { key: "nearside", label: "Nearside", row: "nearside", col: 2 },
  { key: "nearside_rear", label: "Nearside rear", row: "nearside", col: 3 },
] as const;
