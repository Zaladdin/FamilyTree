# Pyramid display — 2026-09-14

## Scope

An additional Russian `Круг / Пирамида` display switch; circle remains the default.
The pyramid uses recorded generations, oldest above youngest. Its tier envelopes
widen downward without inventing people when a younger generation is smaller.
People stay circular and retain selection, kinship, close-family filtering,
zoom, inspector close, pointer dragging and Shift+arrow movement.

Manual positions are kept separately for the two display modes until reload.
Full-family pyramid coordinates also survive changes in the selected person.
Changing the display fits the complete diagram; selecting a person still zooms in.
The minimap accounts for letterboxing on non-square diagrams.

Pyramid is also available in PNG/PDF export, with its own export perspective.
It uses the existing recorded-ancestor branch policy, not the on-screen filter.
Circle export from pyramid view uses remembered circle coordinates, not pyramid
coordinates. Tree export still has ancestors at its roots, below descendants.

## TDD evidence

- Geometry/display RED: 7 passing / 2 failing tests (missing geometry module and
  ignored display mode); GREEN: 14/14, then 47/47 layout regressions.
- UI switch RED: the accessible `Вид дерева` group was absent. GREEN: SSR confirms
  native toggle buttons, radial default, eight real people and one visibility checkbox.
- Minimap RED: missing mapping function. GREEN: wide/tall letterboxing, clamped
  clicks and zero-size fallback.
- Export RED: 19 passing / 4 failing scoped tests; GREEN: 23/23 export/dialog/download.
- Initial complete isolated suite: 229/229, TypeScript and ESLint clean.
- Specialist React/TypeScript review caught clipped pyramid apex during fit.
  A follow-up regression covers full outline bounds on desktop and mobile.
  RED: 13 passing / 1 failing viewport test; GREEN: 28/28 scoped checks. Fit now
  includes the apex, base and any manually moved circles with 24px/56px margins.
- Final isolated suite after that fix: 230/230.
- Production build completed successfully, including its TypeScript/ESLint checks;
  the verified project server was restarted on loopback port 3000.

## Browser verification

Used the local in-memory marriage fixture, never the private Neon database.

- Both layouts retain eight people and eleven recorded relationships.
- Pyramid switch fits the overview; choosing a different person restores 100% zoom.
- A Shift+right move changes the node by 12 logical units; switching to circle and
  back restores the pyramid position; changing perspective retains that position.
- Pointer drag at 26% zoom changes the individual node without changing selection;
  reset restores automatic placement.
- Inspector close clears selection; the existing close-family checkbox works.
- At 375x812, page content is 360px wide without horizontal overflow; both view
  buttons remain 44px high and within the viewport.
- Export perspective is independent; pyramid PNG download succeeded and its actual
  2336x2336 image was visually inspected: readable names, full outline and correct
  parents above children. PDF encoding is unchanged and covered by existing tests.
- No browser warning/error logs in the isolated fixture.
- Final production `/demo` check: eight people, selected pyramid mode at 46%, full
  outline inside the 660px canvas with 56px above and below, and no console warnings
  or errors. Temporary fixture tab/server were closed/stopped; private data untouched.

ECC `tdd-workflow` guided test-first implementation; `frontend-a11y` guided native
labelled controls, pressed states, focus visibility and keyboard operation.
No new dependency, database write, migration, external upload or deployment.
