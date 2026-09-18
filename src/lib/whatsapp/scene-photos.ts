export function scenePhotosWhatsAppBody(fileReference: string, registration?: string | null): string {
  const vehicle = (registration || "").trim();
  const vehicleBit = vehicle ? ` (${vehicle})` : "";
  return `Please send the photographs taken at the scene of the accident${vehicleBit} for file ${fileReference} via this WhatsApp chat. Complete Accident Solutions.`;
}

export function scenePhotosWhatsAppSubject(fileReference: string): string {
  return `Request scene photographs — ${fileReference}`;
}
