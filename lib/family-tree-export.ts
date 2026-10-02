import { buildFamilyOverviewLayout } from "@/lib/family-overview-layout";
import { getFamilyExportBranch } from "@/lib/family-export-branch";
import { buildFamilyPyramidLayout } from "@/lib/family-pyramid-layout";
import { getPersonFullName, type FamilyTreeLayout, type FamilyTreeLayoutNode } from "@/lib/family-utils";
import type { Family } from "@/lib/types";

export type TreeExportStyle = "tree" | "circle" | "pyramid";
export type FamilyTreeExport = { svg: string; width: number; height: number; peopleCount: number };

const PAPER = "#f8f5ec";
const INK = "#354435";
const OLIVE = "#7c8960";
const GOLD = "#b9a16b";
const EXPORT_SUBTITLES: Record<TreeExportStyle, string> = {
  tree: "Корни — старшие предки · Ветви — потомки",
  circle: "Семейный круг · ваше расположение",
  pyramid: "Пирамида · Старшие предки сверху · Потомки ниже",
};
const EXPORT_FOOTNOTES: Record<TreeExportStyle, string> = {
  tree: "Ветви и листья — оформление. Линии обозначают только записанные родственные связи.",
  circle: "Сохранены видимые люди и их расположение. Линии обозначают записанные связи.",
  pyramid: "Контур пирамиды — оформление. Линии обозначают только записанные родственные связи.",
};

function escapeXml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function wrapText(value: string, columns: number, maximumLines: number): string[] {
  const words = value.trim().replace(/\s+/g, " ").split(" ").flatMap((word) => {
    const characters = Array.from(word);
    const parts: string[] = [];
    for (let index = 0; index < characters.length; index += columns) parts.push(characters.slice(index, index + columns).join(""));
    return parts;
  });
  const lines: string[] = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last && Array.from(`${last} ${word}`).length <= columns) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  if (lines.length <= maximumLines) return lines;
  return [...lines.slice(0, maximumLines - 1), `${Array.from(lines[maximumLines - 1]).slice(0, columns - 1).join("")}…`];
}

function textLines(lines: string[], x: number, y: number, lineHeight: number, fontSize: number, extra = "") {
  return `<text x="${x}" y="${y}" text-anchor="middle" font-size="${fontSize}" ${extra}>${lines.map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${escapeXml(line)}</tspan>`).join("")}</text>`;
}

function personCard(node: FamilyTreeLayoutNode, isRoot = false, showRootCaption = true) {
  const size = node.size ?? 188;
  const radius = size / 2;
  const compact = size < 160;
  const fullName = getPersonFullName(node.person);
  const fontSize = compact ? 12 : 17;
  const lines = wrapText(fullName, compact ? 14 : 18, 4);
  const lineHeight = compact ? 14 : 20;
  const nameHeight = (lines.length - 1) * lineHeight;
  const initials = `${Array.from(node.person.firstName)[0] ?? ""}${Array.from(node.person.lastName)[0] ?? ""}`;
  const date = [node.person.birthDate, node.person.deathDate].filter(Boolean).join(" - ");
  if (node.width && node.height) {
    const left = -node.width / 2;
    const top = -node.height / 2;
    const name = wrapText(fullName, 19, 2);
    return `<g data-person-id="${escapeXml(node.person.id)}" data-x="${node.x}" data-y="${node.y}" data-is-root="${isRoot}" data-is-focus="${node.isFocus}" data-card-shape="rectangle" transform="translate(${node.x} ${node.y})">
<title>${escapeXml(fullName)}</title>
<rect x="${left}" y="${top}" width="${node.width}" height="${node.height}" rx="8" fill="#fffdf8" stroke="${node.isFocus ? "#a33b36" : "#ded9ce"}" stroke-width="${node.isFocus ? 2 : 1}"/>
<circle cx="${left + 33}" cy="0" r="21" fill="#eae3d6"/>
<text x="${left + 33}" y="5" text-anchor="middle" font-family="Arial, sans-serif" font-size="14" fill="${INK}">${escapeXml(initials)}</text>
<text x="${left + 64}" y="-13" font-family="Arial, sans-serif" font-size="12" fill="${INK}">${name.map((line, index) => `<tspan x="${left + 64}" dy="${index ? 15 : 0}">${escapeXml(line)}</tspan>`).join("")}</text>
<text x="${left + 64}" y="25" font-family="Arial, sans-serif" font-size="9" fill="#6c6a62">${escapeXml(wrapText(date, 26, 1).join(""))}</text>
</g>`;
  }
  const dateLines = wrapText(date, compact ? 22 : 32, 1);
  const isFocus = node.isFocus;
  const badgeRadius = compact ? 14 : 21;
  const badgeY = -radius + (compact ? 23 : 34);
  const nameY = Math.max(badgeY + badgeRadius + (compact ? 15 : 21), -nameHeight / 2 + (compact ? 8 : 14));
  return `<g data-person-id="${escapeXml(node.person.id)}" data-x="${node.x}" data-y="${node.y}" data-is-root="${isRoot}" data-is-focus="${isFocus}" transform="translate(${node.x} ${node.y})">
<title>${escapeXml(fullName)}</title>
<circle r="${radius + 4}" fill="${PAPER}" stroke="${isFocus ? GOLD : "#e9e3d3"}" stroke-width="${isFocus ? 3 : 1}"/>
<circle r="${radius}" fill="${isFocus ? "#fffaf0" : "#fffdf7"}" stroke="${isFocus ? INK : "#a7b191"}" stroke-width="${isFocus ? 2 : 1.2}"/>
<circle cy="${badgeY}" r="${badgeRadius}" fill="${isFocus ? "#e4d6b8" : "#e9eddf"}"/>
<text y="${badgeY + (compact ? 4 : 6)}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="${compact ? 12 : 18}" fill="${INK}">${escapeXml(initials)}</text>
${textLines(lines, 0, nameY, lineHeight, fontSize, `font-family="Georgia, 'Times New Roman', serif" fill="${INK}"`)}
${textLines(dateLines, 0, Math.min(radius - 14, nameY + nameHeight + 17), 11, compact ? 8 : 10, 'font-family="Arial, sans-serif" fill="#73786a"')}
${isRoot && showRootCaption ? `<text x="0" y="${radius + 23}" text-anchor="middle" font-family="Arial, sans-serif" font-size="9" letter-spacing="2" fill="#937844">КОРНИ СЕМЬИ</text>` : ""}
</g>`;
}

function botanicalTree(width: number, height: number, nodes: FamilyTreeLayoutNode[], rootIds: Set<string>) {
  const roots = nodes.filter((node) => rootIds.has(node.person.id));
  const cx = roots.length ? roots.reduce((sum, node) => sum + node.x, 0) / roots.length : width / 2;
  const ground = Math.min(height - 26, Math.max(0, ...nodes.map((node) => node.y + (node.size ?? 188) / 2)) + 80);
  const crownY = height * 0.3;
  const treeHeight = Math.max(250, ground - 80);
  const canopyWidth = Math.max(300, width * 0.46);
  const branch = (direction: number, level: number) => {
    const endX = cx + direction * canopyWidth * (0.54 + level * 0.11);
    const endY = crownY + level * treeHeight * 0.135;
    const startY = ground - treeHeight * (0.12 + level * 0.055);
    return `<path d="M ${cx} ${startY} C ${cx + direction * width * 0.04} ${endY + treeHeight * 0.17}, ${endX - direction * width * 0.13} ${endY + 20}, ${endX} ${endY}" fill="none" stroke="#a3ab88" stroke-width="${24 - level * 4}" stroke-linecap="round"/>`;
  };
  const leaves = Array.from({ length: 46 }, (_, index) => {
    const angle = index * 2.399963;
    const radius = Math.sqrt((index + 1) / 46);
    const x = cx + Math.cos(angle) * radius * canopyWidth;
    const y = crownY + Math.sin(angle) * radius * treeHeight * 0.31;
    return `<ellipse cx="${x}" cy="${y}" rx="${23 + index % 4 * 5}" ry="${9 + index % 3 * 3}" transform="rotate(${angle * 180 / Math.PI} ${x} ${y})" fill="${index % 3 === 0 ? GOLD : OLIVE}"/>`;
  }).join("");
  const rootTendrils = roots.flatMap((root, index) => [-1, 1].map((direction) => {
    const startY = root.y + (root.size ?? 188) / 2 + 29;
    const endX = Math.max(42, Math.min(width - 42, root.x + direction * (54 + index % 3 * 20)));
    return `<path d="M ${root.x} ${startY} C ${root.x + direction * 8} ${ground - 10}, ${endX - direction * 20} ${ground - 1}, ${endX} ${ground + 4}" fill="none" stroke="#9a865c" stroke-width="3" stroke-linecap="round"/>`;
  })).join("");
  return `<g data-decoration="botanical-tree" aria-hidden="true" opacity="0.46">
<ellipse cx="${width / 2}" cy="${crownY}" rx="${canopyWidth}" ry="${treeHeight * 0.3}" fill="#e8ecd9" opacity="0.75"/>
<path d="M ${cx - 37} ${ground} C ${cx - 12} ${ground - treeHeight * 0.3}, ${cx - 15} ${ground - treeHeight * 0.65}, ${cx + 4} ${crownY} C ${cx + 15} ${ground - treeHeight * 0.55}, ${cx + 7} ${ground - treeHeight * 0.25}, ${cx + 37} ${ground} Z" fill="#8c9771"/>
${[-1, 1].flatMap((direction) => [0, 1, 2, 3].map((level) => branch(direction, level))).join("")}
<path d="M ${cx - 92} ${ground + 8} Q ${cx} ${ground - 21} ${cx + 92} ${ground + 8}" fill="none" stroke="${GOLD}" stroke-width="3"/>
${rootTendrils}${leaves}</g>`;
}

function pyramidDecoration(layout: ReturnType<typeof buildFamilyPyramidLayout>) {
  if (!layout.pyramidOutline) return "";
  const levels = layout.pyramidLevels.filter((level) => Number.isFinite(level.y) && Number.isFinite(level.halfWidth) && level.halfWidth > 0);
  return `<g data-decoration="pyramid" aria-hidden="true">
<path d="${escapeXml(layout.pyramidOutline)}" fill="#e8ecd9" fill-opacity="0.35" stroke="${GOLD}" stroke-width="1.5" stroke-opacity="0.55"/>
${levels.map((level) => `<path d="M ${layout.width / 2 - level.halfWidth} ${level.y} H ${layout.width / 2 + level.halfWidth}" fill="none" stroke="#cbd0b9" stroke-width="1" stroke-dasharray="4 10"/>`).join("")}
</g>`;
}

/** Pure, self-contained SVG: no photos, private prose, network requests or HTML. */
export function buildFamilyTreeExport(family: Family, layout: FamilyTreeLayout, style: TreeExportStyle, focusPersonId?: string | null): FamilyTreeExport {
  const chosenId = focusPersonId ?? layout.nodes.find((node) => node.isFocus)?.person.id ?? family.people[0]?.id ?? null;
  const branch = style === "circle" ? null : getFamilyExportBranch(family, chosenId);
  const scopedFamily = branch?.family ?? family;
  const pyramid = style === "pyramid" ? buildFamilyPyramidLayout(scopedFamily, branch?.focusPersonId ?? null, false) : null;
  const source = pyramid ?? (style === "tree" ? buildFamilyOverviewLayout(scopedFamily, null) : layout);
  const scopeIds = new Set(scopedFamily.people.map((person) => person.id));
  const nodes = source.nodes.filter((node) => scopeIds.has(node.person.id) && Number.isFinite(node.x) && Number.isFinite(node.y))
    .map((node) => style === "tree" ? { ...node, y: source.height - node.y, isFocus: node.person.id === branch?.focusPersonId } : node);
  const visibleIds = new Set(nodes.map((node) => node.person.id));
  const rootIds = new Set(branch?.rootIds ?? []);
  const left = Math.min(0, ...nodes.map((node) => node.x - (node.width ?? node.size ?? 188) / 2 - 40));
  const top = Math.min(0, ...nodes.map((node) => node.y - (node.height ?? node.size ?? 188) / 2 - 40));
  const diagramWidth = Math.max(600, Number.isFinite(source.width) ? source.width : 0, ...nodes.map((node) => node.x + (node.width ?? node.size ?? 188) / 2 + 40)) - left;
  const diagramHeight = Math.max(400, Number.isFinite(source.height) ? source.height : 0, ...nodes.map((node) => node.y + (node.height ?? node.size ?? 188) / 2 + 40)) - top;
  const width = Math.max(1100, diagramWidth + 120);
  const height = Math.max(960, diagramHeight + 390);
  const diagramX = (width - diagramWidth) / 2 - left;
  const diagramY = 252 - top;
  const recordedKeys = new Set(scopedFamily.relationships.filter((edge) => visibleIds.has(edge.fromPersonId) && visibleIds.has(edge.toPersonId) && edge.fromPersonId !== edge.toPersonId)
    .map((edge) => `${edge.type}:${JSON.stringify(edge.type === "parent" ? [edge.fromPersonId, edge.toPersonId] : [edge.fromPersonId, edge.toPersonId].sort())}`));
  const links = source.links.flatMap((link) => {
    const keys = (link.relationshipKeys ?? [link.key]).filter((key) => recordedKeys.has(key));
    if (!keys.length || !/^[MmLlHhVvCcSsQqTtAaZz\d\s.,+eE-]+$/.test(link.d)) return [];
    const spouse = keys.every((key) => key.startsWith("spouse:"));
    const sibling = keys.every((key) => key.startsWith("sibling:"));
    return [`<path data-relationship-keys="${escapeXml(JSON.stringify(keys))}" d="${escapeXml(link.d)}" fill="none" stroke="${spouse ? OLIVE : sibling ? "#77728f" : "#9a765b"}" stroke-width="${spouse ? 1.9 : 1.6}"${spouse ? ' stroke-dasharray="7 6"' : sibling ? ' stroke-dasharray="2 5"' : ""} stroke-linejoin="round" stroke-linecap="round"/>`];
  }).join("");
  const title = family.title || (family.surname ? `Семья ${family.surname}` : "История нашей семьи");
  const heading = textLines(wrapText(title, 48, 2), width / 2, 102, 37, 32, `font-family="Georgia, 'Times New Roman', serif" fill="${INK}"`);
  const chosenPerson = nodes.find((node) => node.isFocus)?.person;
  const selectionCaption = chosenPerson ? `Выбрано: ${getPersonFullName(chosenPerson)}` : "История вашей семьи";
  const selectionHeading = textLines(wrapText(selectionCaption, 85, 2), width / 2, 192, 18, 13, `font-family="Arial, sans-serif" fill="${INK}"`);
  const footerY = height - 67;
  // Keep intrinsic dimensions browser-safe while preserving the entire logical viewBox.
  const outputScale = Math.min(1, 8192 / width, 8192 / height);
  const outputWidth = Math.max(1, Math.round(width * outputScale));
  const outputHeight = Math.max(1, Math.round(height * outputScale));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${outputWidth}" height="${outputHeight}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Семейное древо">
<title>${escapeXml(title)} — семейное древо</title>
<rect width="${width}" height="${height}" fill="${PAPER}"/>
<rect x="24" y="24" width="${width - 48}" height="${height - 48}" rx="5" fill="none" stroke="${GOLD}" stroke-width="1"/>
<rect x="32" y="32" width="${width - 64}" height="${height - 64}" rx="3" fill="none" stroke="#ddd3bc" stroke-width="0.6"/>
<text x="${width / 2}" y="62" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" letter-spacing="5" fill="${OLIVE}">RODOVO · СЕМЕЙНЫЙ АРХИВ</text>
${heading}
<text x="${width / 2}" y="165" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" letter-spacing="1" fill="#747b68">${EXPORT_SUBTITLES[style]} · ${nodes.length} чел.</text>
${selectionHeading}
<path d="M ${width / 2 - 56} 231 H ${width / 2 + 56}" stroke="${GOLD}" stroke-width="1"/>
<g transform="translate(${diagramX} ${diagramY})">
${style === "tree" ? botanicalTree(diagramWidth, diagramHeight, nodes, rootIds) : pyramid ? pyramidDecoration(pyramid) : `<circle cx="${diagramWidth / 2}" cy="${diagramHeight / 2}" r="${Math.min(diagramWidth, diagramHeight) * 0.39}" fill="none" stroke="#e6dfce" stroke-width="1" stroke-dasharray="3 12"/>`}
<g data-recorded-links="true"${style === "tree" ? ` transform="translate(0 ${source.height}) scale(1 -1)"` : ""}>${links}</g>
${nodes.map((node) => personCard(node, rootIds.has(node.person.id), style === "tree")).join("\n")}
${nodes.length ? "" : `<text x="${diagramWidth / 2}" y="${diagramHeight / 2}" text-anchor="middle" font-family="Georgia, serif" font-size="24" fill="${OLIVE}">Здесь начинается история вашей семьи</text>`}
</g>
<g font-family="Arial, sans-serif" font-size="11" fill="#747b68">
<path d="M ${width / 2 - 278} ${footerY - 4} h 30" stroke="#9a765b" stroke-width="1.6"/><text x="${width / 2 - 238}" y="${footerY}">Родители и дети</text>
<path d="M ${width / 2 - 50} ${footerY - 4} h 30" stroke="${OLIVE}" stroke-width="1.9" stroke-dasharray="7 6"/><text x="${width / 2 - 10}" y="${footerY}">Супруги</text>
<path d="M ${width / 2 + 112} ${footerY - 4} h 30" stroke="#77728f" stroke-width="1.6" stroke-dasharray="2 5"/><text x="${width / 2 + 152}" y="${footerY}">Братья и сёстры</text>
<text x="${width / 2}" y="${height - 43}" text-anchor="middle" font-size="9" fill="#969984">${EXPORT_FOOTNOTES[style]}</text>
</g></svg>`;
  return { svg, width: outputWidth, height: outputHeight, peopleCount: nodes.length };
}
