/**
 * Ticket de 80 mm en PDF (sous-projet 5 § 5.1) : dessine les rangées de
 * `ticket.ts` avec pdfkit, polices de la charte embarquées, noir sur blanc,
 * logo de l'institut en tête s'il est déposé (vague B). Largeur 80 mm, zone imprimable de 72 mm, hauteur selon le
 * contenu (une seule page, mesurée avant de dessiner). Aucun fichier stocké :
 * le PDF est refait à chaque demande depuis les valeurs figées, et le même
 * document donne toujours les mêmes octets (date du PDF = date d'émission).
 */
import { createHash } from "node:crypto";
import PDFDocument from "pdfkit";
import { PNG } from "pngjs";
import { readLogo } from "../institut/logos.ts";
import { readResource, type TicketResource } from "./ressources.ts";
import { ticketRows, type TicketDocument, type TicketRow, type TicketStyle } from "./ticket.ts";

const MM = 72 / 25.4;
/** Largeur du papier : 80 mm (226,77 pt). */
export const TICKET_WIDTH = 80 * MM;
/** Marge de chaque côté : (80 − 72) / 2 = 4 mm, zone imprimable de 72 mm. */
const MARGIN = 4 * MM;
const CONTENT = TICKET_WIDTH - 2 * MARGIN;
const ROW_GAP = 2;
const RULE_SPACE = 6;
const PAIR_GAP = 8;

type Font = "garamond-400" | "garamond-600" | "jost-400" | "jost-500";

/** Police, corps, interligne et espacement des lettres de chaque style. */
const STYLES: Record<TicketStyle, { font: Font; size: number; spacing?: number }> = {
  nom: { font: "garamond-600", size: 15 },
  entete: { font: "jost-400", size: 7.5 },
  titre: { font: "jost-500", size: 10, spacing: 1.5 },
  numero: { font: "garamond-600", size: 12.5 },
  corps: { font: "jost-400", size: 8.5 },
  detail: { font: "jost-400", size: 7.5 },
  total: { font: "garamond-600", size: 13 },
  mention: { font: "jost-400", size: 7 },
  merci: { font: "garamond-400", size: 10.5 },
};

const FONTS: Font[] = ["garamond-400", "garamond-600", "jost-400", "jost-500"];

/** Titre, auteur et date du PDF : la date du document, pour que le même document donne les mêmes octets. */
export interface TicketMeta {
  title: string;
  author: string;
  date: number;
}

function newDocument(height: number, meta: TicketMeta, compress: boolean): PDFKit.PDFDocument {
  const pdf = new PDFDocument({
    size: [TICKET_WIDTH, height],
    margin: 0,
    compress,
    // Police par défaut : EB Garamond, jamais une police standard (Helvetica) que le paquet livré ne contient pas.
    font: readResource("garamond-400.woff") as unknown as string,
    info: { Title: meta.title, Author: meta.author, Creator: "lama", Producer: "lama", CreationDate: new Date(meta.date) },
  });
  for (const name of FONTS) pdf.registerFont(name, readResource(`${name}.woff` as TicketResource));
  return pdf;
}

function useStyle(pdf: PDFKit.PDFDocument, style: TicketStyle): { spacing: number } {
  const s = STYLES[style];
  pdf.font(s.font).fontSize(s.size);
  return { spacing: s.spacing ?? 0 };
}

const LOGO_BOX = { width: 40 * MM, height: 18 * MM };

/** Pose (ou mesure seulement, `draw` faux) les rangées à partir du haut ; rend la hauteur utilisée. */
function layout(pdf: PDFKit.PDFDocument, rows: TicketRow[], draw: boolean, logo: Buffer | null): number {
  let y = MARGIN;
  for (const row of rows) {
    if (row.type === "rule") {
      y += RULE_SPACE;
      if (draw) pdf.save().moveTo(MARGIN, y).lineTo(TICKET_WIDTH - MARGIN, y).lineWidth(0.5).dash(1.5, { space: 1.5 }).stroke("#000000").restore();
      y += RULE_SPACE;
    } else if (row.type === "logo") {
      // Logo de l'institut (vague B) : boîte de 40 × 18 mm, centrée ; image absente ou illisible : rien, jamais d'échec.
      if (!logo) continue;
      let size: { width: number; height: number };
      try {
        // `openImage` existe à l'exécution mais manque aux types de pdfkit.
        const image = (pdf as unknown as { openImage(data: Buffer): { width: number; height: number } }).openImage(logo);
        const scale = Math.min(LOGO_BOX.width / image.width, LOGO_BOX.height / image.height);
        size = { width: image.width * scale, height: image.height * scale };
        if (draw) pdf.image(logo, MARGIN + (CONTENT - size.width) / 2, y, { width: size.width, height: size.height });
      } catch {
        continue;
      }
      y += size.height + RULE_SPACE;
    } else if (row.type === "text") {
      const { spacing } = useStyle(pdf, row.style);
      const options = { width: CONTENT, align: row.align, characterSpacing: spacing };
      const height = pdf.heightOfString(row.text, options);
      if (draw) pdf.fillColor("#000000").text(row.text, MARGIN, y, options);
      y += height + ROW_GAP;
    } else {
      const { spacing } = useStyle(pdf, row.style);
      const rightWidth = Math.min(pdf.widthOfString(row.right, { characterSpacing: spacing }) + 1, CONTENT / 2);
      const leftWidth = CONTENT - rightWidth - PAIR_GAP;
      const left = { width: leftWidth, characterSpacing: spacing };
      const right = { width: rightWidth, align: "right" as const, characterSpacing: spacing };
      const height = Math.max(pdf.heightOfString(row.left, left), pdf.heightOfString(row.right, right));
      if (draw) {
        pdf.fillColor("#000000").text(row.left, MARGIN, y, left);
        pdf.text(row.right, TICKET_WIDTH - MARGIN - rightWidth, y, right);
      }
      y += height + ROW_GAP;
    }
  }
  return y + MARGIN;
}

/**
 * PDF du document : une page de 80 mm de large, aussi haute que son contenu.
 * `compress` à faux laisse les instructions de dessin lisibles (tests).
 */
export function renderTicket(doc: TicketDocument, options: { compress?: boolean; logo?: Buffer | null } = {}): Promise<Buffer> {
  // Le logo utilisable est décidé une fois, avant les rangées : un logo illisible laisse le nom en tête.
  const logo = usableLogo(options.logo);
  return renderRows(ticketRows(doc, { logo: logo !== null }), { title: doc.number, author: doc.fiscal.nom, date: doc.issued_at }, { ...options, logo });
}

/**
 * Rangées déjà composées (ticket d'une facture, ticket de clôture de caisse)
 * en PDF de 80 mm, même mise en page que le ticket.
 */
export function renderRows(rows: TicketRow[], meta: TicketMeta, options: { compress?: boolean; logo?: Buffer | null } = {}): Promise<Buffer> {
  const logo = usableLogo(options.logo);
  const compress = options.compress ?? true;
  const height = Math.ceil(layout(newDocument(1000, meta, compress), rows, false, logo));
  const pdf = newDocument(height, meta, compress);
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    layout(pdf, rows, true, logo);
    pdf.end();
  });
}

/** Verdicts déjà rendus, par empreinte de l'image (une même image n'est décodée qu'une fois). */
const verdicts = new Map<string, boolean>();

/**
 * L'image si pdfkit sait l'ouvrir, sinon `null`. Un PNG est aussi décodé par pngjs : pdfkit
 * décode ses données dans un rappel asynchrone où un IDAT abîmé lève une exception non
 * interceptée et le PDF ne se termine jamais.
 */
export function usableLogo(image: Buffer | null | undefined): Buffer | null {
  if (!image || image.length === 0) return null;
  const key = createHash("sha1").update(image).digest("hex");
  let ok = verdicts.get(key);
  if (ok === undefined) {
    try {
      const pdf = new PDFDocument({ margin: 0, font: readResource("garamond-400.woff") as unknown as string });
      (pdf as unknown as { openImage(data: Buffer): unknown }).openImage(image);
      if (image[0] === 0x89) PNG.sync.read(image);
      ok = true;
    } catch {
      ok = false;
    }
    if (verdicts.size >= 16) verdicts.clear();
    verdicts.set(key, ok);
  }
  return ok ? image : null;
}

/** Version du logo clair déjà validée, avec son image : évite de relire la validation à chaque PDF. */
let checked: { version: number; image: Buffer | null } | null = null;

/** Logo clair de l'institut pour les PDF ; `null` sans logo, logo illisible ou lecture en échec (un document sort toujours). */
export async function documentLogo(): Promise<Buffer | null> {
  try {
    const logo = await readLogo("clair");
    if (!logo) return null;
    if (checked?.version !== logo.version) checked = { version: logo.version, image: usableLogo(logo.bytes) };
    return checked.image;
  } catch {
    return null;
  }
}
