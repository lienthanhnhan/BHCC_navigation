import type { BuildingEdge, BuildingGraph, BuildingNode } from "./types";

function node(
  id: string,
  label: string,
  kind: BuildingNode["kind"],
  floor: number,
  x: number,
  y: number,
  exitBearing?: number,
  aliases?: string[],
): BuildingNode {
  return { id, label, kind, floor, x, y, exitBearing, aliases };
}

function link(
  edges: BuildingEdge[],
  prefix: string,
  from: string,
  to: string,
  weight: number,
  bearing: number,
  kind: BuildingEdge["kind"] = "walk",
): void {
  edges.push(
    { id: `${prefix}-f`, from, to, weight, bearing, kind },
    { id: `${prefix}-r`, from: to, to: from, weight, bearing: (bearing + 180) % 360, kind },
  );
}

function attach(
  edges: BuildingEdge[],
  prefix: string,
  core: string,
  room: string,
  weight: number,
  bearing: number,
  kind: BuildingEdge["kind"] = "door",
): void {
  link(edges, prefix, core, room, weight, bearing, kind);
}

const nodes: BuildingNode[] = [
  node("n1-core", "N1 Core", "intersection", 1, 0, 0, 180),
  node("n1-stairs", "N1 Stairs", "stairs", 1, -10, -4),
  node("n1-elevator", "N1 Elevator", "elevator", 1, 10, -4),
  node("n1-west", "N1 West Hall", "corridor", 1, -20, 0),
  node("n1-east", "N1 East Hall", "corridor", 1, 20, 0),
  node("b1-core", "B1 Core", "intersection", 1, -34, -3),
  node("c1-core", "C1 Core", "intersection", 1, -16, -2),
  node("d1-core", "D1 Core", "intersection", 1, -2, -2),
  node("e1-core", "E1 Core", "intersection", 1, 18, 6),
  node("g1-core", "G1 Core", "intersection", 1, 34, 3),

  node("b2-core", "B2 Corridor", "intersection", 2, -34, -3),
  node("c2-core", "C2 Corridor", "intersection", 2, -16, -2),
  node("d2-core", "D2 Corridor", "intersection", 2, -2, -2),
  node("e2-core", "E2 Corridor", "intersection", 2, 18, 6),
  node("g2-core", "G2 Corridor", "intersection", 2, 34, 3),
  node("n2-core", "N2 Corridor", "intersection", 2, 52, 0),
  node("n2-stairs", "N2 Stairs", "stairs", 2, 46, 2),
  node("n2-elevator", "N2 Elevator", "elevator", 2, 48, -4),
  node("n2-east", "N2 East Hall", "corridor", 2, 60, 0),

  node("b3-core", "B3 Core", "intersection", 3, -34, -3),
  node("c3-core", "C3 Core", "intersection", 3, -16, -2),
  node("d3-core", "D3 Core", "intersection", 3, -2, -2),
  node("e3-core", "E3 Core", "intersection", 3, 18, 6),
  node("e3-east", "E3 East Hall", "corridor", 3, 28, 8),
  node("g3-core", "G3 Core", "intersection", 3, 34, 3),
  node("n3-core", "N3 Corridor", "intersection", 3, 52, 0),
  node("n3-stairs", "N3 Stairs", "stairs", 3, 46, 2),
  node("n3-elevator", "N3 Elevator", "elevator", 3, 48, -4),
  node("n3-east", "N3 East Hall", "corridor", 3, 60, 0),

  node("e4-core", "E4 Corridor", "intersection", 4, 18, 6),
  node("e4-east", "E4 East Hall", "corridor", 4, 28, 8),

  node("N-102", "N-102", "room", 1, -4, 8, 180, ["N102", "N-Building Security Desk"]),
  node("N-111", "N-111", "room", 1, 6, 8, 180, ["N111", "Internships & Career Development", "Workforce & Economic Development"]),
  node("N-113", "N-113", "room", 1, 10, 8, 180, ["N113", "Single Stop"]),
  node("N-114", "N-114", "room", 1, 14, 8, 180, ["N114", "Center for Self-Directed Learning", "CSDL"]),
  node("N-116", "N-116", "room", 1, 18, 8, 180, ["N116", "Veterans Center"]),
  node("N-119", "N-119", "room", 1, 22, 10, 180, ["N119", "N-Building Lounge, 1st Floor"]),
  node("G-102", "G-102", "room", 1, 36, 10, 180, ["G102", "Fitness Center"]),
  node("G-110", "G-110", "room", 1, 38, 8, 180, ["G110", "Gymnasium"]),
  node("G-117", "G-117", "room", 1, 40, 6, 180, ["G117", "Athletic Office Suite"]),
  node("G-130", "G-130", "room", 1, 42, 4, 180, ["G130", "Faculty Offices Suite"]),
  node("G-229", "G-229", "room", 1, 44, 2, 180, ["G229", "Health Center Lobby"]),
  node("B-101", "B-101", "room", 1, -42, -8, 90, ["B101", "DISH Food Pantry"]),
  node("B-118", "B-118", "room", 1, -44, -4, 90, ["B118", "Assessment & Testing Center"]),
  node("B-138", "B-138", "room", 1, -45, -2, 90, ["B138", "Student Counseling", "Prevention and Wellness Center"]),
  node("B-150", "B-150", "room", 1, -46, 0, 90, ["B150"]),
  node("B-200", "B-200", "room", 1, -48, 4, 90, ["B200", "Admissions Office", "Student Central", "Academic Records", "Financial Aid", "Student Payment"]),
  node("E-144", "E-144", "room", 1, 20, 14, 180, ["E144", "Language Lab"]),
  node("E-173B", "E-173B", "room", 1, 24, 12, 180, ["E173B", "E-Building Lounge", "1st Floor"]),
  node("C-102", "C-102", "room", 1, -18, 8, 90, ["C102", "C-Lounge"]),
  node("D-113", "D-113", "room", 1, 0, 10, 180, ["D113", "Academic Computing Center"]),
  node("D-201", "D-201", "room", 1, 2, 12, 180, ["D201", "D-Lounge"]),

  node("B-204", "B-204", "room", 2, -42, -8, 90, ["B204", "Central Café"]),
  node("C-202", "C-202", "room", 2, -18, 8, 90, ["C202"]),
  node("D-206", "D-206", "room", 2, -10, 12, 180, ["D206", "College Connection"]),
  node("E-023", "E-023", "room", 2, 14, 16, 180, ["E023", "Facilities Management"]),
  node("E-120", "E-120", "room", 2, 20, 14, 180, ["E120", "Bookstore"]),
  node("E-138", "E-138", "room", 2, 22, 12, 180, ["E138", "Print Center"]),
  node("E-145", "E-145", "room", 2, 24, 10, 180, ["E145", "Commonwealth Honors"]),
  node("E-154", "E-154", "room", 2, 26, 8, 180, ["E154", "Health Services"]),
  node("E-174", "E-174", "room", 2, 28, 6, 180, ["E174", "Welcome Back Center"]),
  node("E-175", "E-175", "room", 2, 30, 4, 180, ["E175", "Conference Room"]),
  node("E-222", "E-222", "room", 2, 32, 2, 180, ["E222", "Disability Support Services"]),
  node("E-223", "E-223", "room", 2, 34, 0, 180, ["E223", "STEM Study"]),
  node("E-224-226", "E-224-226", "room", 2, 36, -2, 180, ["E224226", "E-224", "E-225", "E-226", "MathSpace"]),
  node("E-225", "E-225", "room", 2, 37, -3, 180, ["E225", "Community Connect"]),
  node("E-229", "E-229", "room", 2, 38, -4, 180, ["E229", "TASC", "Tutoring + Academic Support Center"]),
  node("E-230", "E-230", "room", 2, 40, -6, 180, ["E230", "Academic Innovation and Distance Education", "Innovation Lab"]),
  node("E-235", "E-235", "room", 2, -40, 0, 90, ["E235", "Cafe"]),
  node("N-210", "N-210", "room", 2, 54, 6, 180, ["N210", "LifeMap Commons", "Advising", "Transfer Services", "Career Counseling"]),
  node("N-216", "N-216", "room", 2, 56, 4, 180, ["N216", "Learning Communities", "Ace Mentors"]),
  node("N-217", "N-217", "room", 2, 58, 2, 180, ["N217", "TRiO Student Success Program"]),
  node("N-221", "N-221", "room", 2, 60, 0, 180, ["N221", "International Center"]),
  node("N-222", "N-222", "room", 2, 62, -2, 180, ["N222", "N-Building Lounge, 2nd Floor"]),
  node("A-206", "A-206", "room", 2, -24, -10, 90, ["A206", "Public Safety", "Campus Police"]),

  node("N-300", "N-300", "room", 3, 54, 6, 180, ["N300", "Library and Learning Commons"]),
  node("N-310", "N-310", "room", 3, 56, 4, 180, ["N310", "Reading Room"]),
  node("N-311", "N-311", "room", 3, 58, 2, 180, ["N311", "The Writing Place"]),
  node("N-317", "N-317", "room", 3, 60, 0, 180, ["N317", "Classroom"]),
  node("A-300", "A-300", "room", 3, -28, 12, 90, ["A300", "Lecture Hall", "A300 Lounge"]),
  node("A-302", "A-302", "room", 3, -26, 10, 90, ["A302", "Art Gallery"]),
  node("B-303-320", "B-303-320", "room", 3, -42, -8, 90, ["B303320", "B-303", "B-320", "Administrative Offices"]),
  node("B-309", "B-309", "room", 3, -44, -4, 90, ["B309", "Dean of Students"]),
  node("B-336", "B-336", "room", 3, -46, 0, 90, ["B336", "Adjunct Faculty Center"]),
  node("C-302-314", "C-302-314", "room", 3, -18, 8, 90, ["C302314", "C-302", "C-314", "Dean's Office"]),
  node("E-312", "E-312", "room", 3, 14, 16, 180, ["E312", "Quiet Study Area"]),
  node("E-313", "E-313", "room", 3, 20, 14, 180, ["E313", "CECW", "Community Engagement"]),
  node("E-320", "E-320", "room", 3, 22, 12, 180, ["E320", "Faculty Offices"]),
  node("E-331", "E-331", "room", 3, 24, 10, 180, ["E331", "BHCC Foundation"]),
  node("E-333", "E-333", "room", 3, 26, 8, 180, ["E333", "Business Office", "Human Resources", "Payroll Office"]),
  node("E-336", "E-336", "room", 3, 28, 6, 180, ["E336", "Student Activities"]),
  node("E-337", "E-337", "room", 3, 30, 4, 180, ["E337", "Affinity Suite"]),

  node("E-400", "E-400", "room", 4, 20, 14, 180, ["E400"]),
  node("E-410", "E-410", "room", 4, 22, 12, 180, ["E410"]),
  node("E-421", "E-421", "room", 4, 24, 10, 180, ["E421"]),
];

const edges: BuildingEdge[] = [];

link(edges, "n1-hall", "n1-west", "n1-core", 8, 90);
link(edges, "n1-hall-east", "n1-core", "n1-east", 8, 90);
link(edges, "n1-vertical-stairs", "n1-core", "n1-stairs", 5, 180, "stairs");
link(edges, "n1-vertical-elevator", "n1-core", "n1-elevator", 5, 0, "elevator");
link(edges, "n1-b1", "n1-west", "b1-core", 6, 180);
link(edges, "n1-c1", "n1-west", "c1-core", 8, 180);
link(edges, "n1-d1", "n1-core", "d1-core", 4, 90);
link(edges, "n1-e1", "n1-east", "e1-core", 8, 90);
link(edges, "n1-g1", "n1-east", "g1-core", 8, 90);

link(edges, "b-vert-1", "b1-core", "b2-core", 6, 0, "stairs");
link(edges, "b-vert-2", "b2-core", "b3-core", 6, 0, "stairs");
link(edges, "c-vert-1", "c1-core", "c2-core", 6, 0, "stairs");
link(edges, "c-vert-2", "c2-core", "c3-core", 6, 0, "stairs");
link(edges, "d-vert-1", "d1-core", "d2-core", 6, 0, "stairs");
link(edges, "d-vert-2", "d2-core", "d3-core", 6, 0, "stairs");
link(edges, "e-vert-1", "e1-core", "e2-core", 6, 0, "stairs");
link(edges, "e-vert-2", "e2-core", "e3-core", 6, 0, "stairs");
link(edges, "e-vert-3", "e3-core", "e4-core", 6, 0, "stairs");
link(edges, "g-vert-1", "g1-core", "g2-core", 6, 0, "stairs");
link(edges, "g-vert-2", "g2-core", "g3-core", 6, 0, "stairs");
link(edges, "n-vert-1", "n1-core", "n2-core", 6, 0, "stairs");
link(edges, "n-vert-2", "n2-core", "n3-core", 6, 0, "stairs");
link(edges, "n2-stairs-link", "n2-core", "n2-stairs", 4, 180, "stairs");
link(edges, "n2-elevator-link", "n2-core", "n2-elevator", 4, 0, "elevator");
link(edges, "n3-stairs-link", "n3-core", "n3-stairs", 4, 180, "stairs");
link(edges, "n3-elevator-link", "n3-core", "n3-elevator", 4, 0, "elevator");

link(edges, "floor2-bc", "b2-core", "c2-core", 18, 90);
link(edges, "floor2-cd", "c2-core", "d2-core", 14, 90);
link(edges, "floor2-de", "d2-core", "e2-core", 20, 90);
link(edges, "floor2-eg", "e2-core", "g2-core", 16, 90);
link(edges, "floor2-gn", "g2-core", "n2-core", 18, 90);
link(edges, "floor3-n-east", "n3-core", "n3-east", 10, 90);
link(edges, "floor3-e-east", "e3-core", "e3-east", 10, 90);
link(edges, "floor4-e-east", "e4-core", "e4-east", 10, 90);

attach(edges, "n1-102", "n1-west", "N-102", 5, 180);
attach(edges, "n1-111", "n1-core", "N-111", 4, 0);
attach(edges, "n1-113", "n1-core", "N-113", 4, 0);
attach(edges, "n1-114", "n1-core", "N-114", 4, 0);
attach(edges, "n1-116", "n1-east", "N-116", 4, 0);
attach(edges, "n1-119", "n1-east", "N-119", 4, 0);
attach(edges, "g1-102", "g1-core", "G-102", 4, 0);
attach(edges, "g1-110", "g1-core", "G-110", 4, 0);
attach(edges, "g1-117", "g1-core", "G-117", 4, 0);
attach(edges, "g1-130", "g1-core", "G-130", 4, 0);
attach(edges, "g1-229", "g1-core", "G-229", 4, 0);
attach(edges, "b1-101", "b1-core", "B-101", 4, 90);
attach(edges, "b1-118", "b1-core", "B-118", 4, 90);
attach(edges, "b1-138", "b1-core", "B-138", 4, 90);
attach(edges, "b1-150", "b1-core", "B-150", 4, 90);
attach(edges, "b1-200", "b1-core", "B-200", 4, 90);
attach(edges, "e1-144", "e1-core", "E-144", 4, 0);
attach(edges, "e1-173b", "e1-core", "E-173B", 4, 0);
attach(edges, "c1-102", "c1-core", "C-102", 4, 90);
attach(edges, "d1-113", "d1-core", "D-113", 4, 0);

attach(edges, "b2-204", "b2-core", "B-204", 4, 90);
attach(edges, "c2-202", "c2-core", "C-202", 4, 90);
attach(edges, "d2-206", "d2-core", "D-206", 4, 0);
attach(edges, "e2-120", "e2-core", "E-120", 4, 0);
attach(edges, "e2-138", "e2-core", "E-138", 4, 0);
attach(edges, "e2-145", "e2-core", "E-145", 4, 0);
attach(edges, "e2-154", "e2-core", "E-154", 4, 0);
attach(edges, "e2-174", "e2-core", "E-174", 4, 0);
attach(edges, "e2-175", "e2-core", "E-175", 4, 0);
attach(edges, "e2-222", "e2-core", "E-222", 4, 0);
attach(edges, "e2-223", "e2-core", "E-223", 4, 0);
attach(edges, "e2-224", "e2-core", "E-224-226", 4, 0);
attach(edges, "e2-225", "e2-core", "E-225", 4, 0);
attach(edges, "e2-229", "e2-core", "E-229", 4, 0);
attach(edges, "e2-230", "e2-core", "E-230", 4, 0);
attach(edges, "e2-235", "e2-core", "E-235", 4, 0);
attach(edges, "n2-210", "n2-core", "N-210", 4, 0);
attach(edges, "n2-216", "n2-core", "N-216", 4, 0);
attach(edges, "n2-217", "n2-core", "N-217", 4, 0);
attach(edges, "n2-221", "n2-core", "N-221", 4, 0);
attach(edges, "n2-222", "n2-core", "N-222", 4, 0);
attach(edges, "a2-206", "c2-core", "A-206", 6, 180);

attach(edges, "n3-300", "n3-core", "N-300", 4, 0);
attach(edges, "n3-310", "n3-core", "N-310", 4, 0);
attach(edges, "n3-311", "n3-core", "N-311", 4, 0);
attach(edges, "n3-317", "n3-east", "N-317", 4, 0);
attach(edges, "a3-300", "c3-core", "A-300", 6, 180);
attach(edges, "a3-302", "c3-core", "A-302", 6, 180);
attach(edges, "b3-303", "b3-core", "B-303-320", 4, 90);
attach(edges, "b3-309", "b3-core", "B-309", 4, 90);
attach(edges, "b3-336", "b3-core", "B-336", 4, 90);
attach(edges, "c3-302", "c3-core", "C-302-314", 4, 90);
attach(edges, "e3-312", "e3-core", "E-312", 4, 0);
attach(edges, "e3-313", "e3-core", "E-313", 4, 0);
attach(edges, "e3-320", "e3-core", "E-320", 4, 0);
attach(edges, "e3-331", "e3-core", "E-331", 4, 0);
attach(edges, "e3-333", "e3-core", "E-333", 4, 0);
attach(edges, "e3-336", "e3-core", "E-336", 4, 0);
attach(edges, "e3-337", "e3-east", "E-337", 4, 0);

attach(edges, "e4-400", "e4-core", "E-400", 4, 0);
attach(edges, "e4-410", "e4-core", "E-410", 4, 0);
attach(edges, "e4-421", "e4-core", "E-421", 4, 0);

export const sampleBuilding: BuildingGraph = { nodes, edges };
