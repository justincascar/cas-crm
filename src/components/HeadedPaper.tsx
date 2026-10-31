import type { ReactNode } from "react";
import { companyFooterLines, type CompanyDetails } from "@/lib/db/company-details";

/**
 * CAS's headed paper (review note R41), from the supplied CAS-headed-paper.docx: the logo top right, the grey tyre track
 * top left, the red bar down the right-hand edge, and the company details from Settings as a two-line footer. The images
 * are the ones in the .docx, not redrawn.
 *
 * On screen it is one A4 sheet. In print each page carries the logo, tyre track, bar and footer: they are fixed to the
 * page, and the empty table header and footer rows repeat on every page so no text runs under them or the red bar.
 *
 * "logo" is for the supplied Hire Pack pages: their layout and wording are kept, and only the logo is added where there is
 * room, at the top of the first page.
 */
export function HeadedPaper({ company, variant = "full", children }: { company: CompanyDetails; variant?: "full" | "logo"; children: ReactNode }) {
  if (variant === "logo") {
    return (
      <div className="headed-paper-logo" data-headed-paper="logo">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/headed-paper/cas-logo.jpg" alt={company.name} className="hp-logo-inline" />
        {children}
      </div>
    );
  }
  const [first, second] = companyFooterLines(company);
  return (
    <div className="headed-paper" data-headed-paper="full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/headed-paper/tyre-track.png" alt="" aria-hidden="true" className="hp-tyre" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/headed-paper/cas-logo.jpg" alt={company.name} className="hp-logo" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/headed-paper/red-bar.jpg" alt="" aria-hidden="true" className="hp-bar" />
      <table className="hp-frame" role="presentation">
        <thead>
          <tr>
            <td className="hp-top-space" />
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="hp-body">{children}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td className="hp-bottom-space" />
          </tr>
        </tfoot>
      </table>
      <footer className="hp-footer" data-headed-footer>
        <p>{first}</p>
        <p>{second}</p>
      </footer>
    </div>
  );
}
