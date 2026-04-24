# skyhop camera spec v1

Mål: få `SM64`-känsla utan bokstavlig Lakitu-figur och utan att göra kameran till en fri sandbox-orbit. Kameran ska kännas som en osynlig, kompetent operator som hjälper plattforming, håller bra komposition och återtar kontroll när spelaren inte aktivt styr den.

## 1. Designprinciper

1. Kameran är opinionsdriven.
   Den vill ligga bakom spelaren och hålla bra läsbarhet. Spelaren får nudga den, men inte äga den helt hela tiden.

2. Kameran är mode-driven.
   Inte en enda universell orbitformel. Olika situationer har olika beteenden.

3. Kameran är geometry-aware.
   När geometri stör ska den först försöka hitta en bättre vinkel. Att bara shrinka rakt in mot kroppen är sista utvägen.

4. Kameran är markmedveten.
   Höjd och pitch ska reagera på golv, tak, ledges och slides så att den känns "placerad i världen", inte bara fast i spelaren.

5. Kameran är lugn.
   Ingen speed-FOV-breathing, ingen tydlig velocity-lookahead framåt, ingen onödig bob på små hopp.

6. Kameran ska kännas som att en osynlig operatör följer en plan, inte som att kameran är fastbultad i Mario.

## 2. Primära modes

### `default_chase`
Används för nästan allt vanligt spel: grounded, running, airborne, single/double/triple/backflip/side-flip/long-jump/wall-kick/ledge.

Beteende:
- basintention: bakom `player.facing`, inte bakom `velocity`
- mild operator-lag
- subtil lateral pan i fokus
- auto-reclaim efter kort tid utan manuell kamerainput
- slope-aware pitch och höjd
- occlusion löses genom yaw-avoid först

### `slide_chase`
Används för `crouch_slide` och `stomach_slide`.

Beteende:
- starkare bakom-låsning
- något större distans än default
- snabbare yaw-catchup
- tydligare slope- och downhill-läsbarhet
- mindre tolerans för att spelaren ska kunna lämna kameran åt sidan

### `behind_move`
Reservläge för framtida linjära/special-rörelser där kameran måste vara tydligt bakom spelaren, t.ex. future flying/cannon/water eller en explicit assist-knapp. Ska inte vara default för vanlig markrörelse.

Beteende:
- snabb snap/recover bakom spelaren
- diskreta yaw/pitch-steg om man behåller "C-knapps-känsla"
- stabil distans

### `look_mode` (optional)
Ett frivilligt nära läge, mer som `C-Up`, om ni vill ha det senare. Inte nödvändigt i v1.

Beteende:
- kortare distans
- begränsad yaw/pitch-offset
- används som ett temporärt inspect-läge, inte standard

## 3. Hidden state som kameran bör ha

Det viktiga är att ha dold state, även om spelaren inte ser modes/UI.

- `mode: default_chase | slide_chase | behind_move | look_mode`
- `modeEnterT`
- `goalPos`, `goalFocus`
- `curPos`, `curFocus`
- `goalYaw`, `goalPitch`, `goalDist`
- `modeOffsetYaw`
- `panDistance`
- `zoomState: normal | zoomed_out | close`
- `lastManualCamInputT`
- `manualInfluence` i intervallet `0..1`
- `occlusionYawBias`
- `occlusionHoldT`
- `collisionShrinkT`
- `stableFocusY`
- `airborneStableT`
- `lastGoodYaw`
- `recenterRequestT`

## 4. Update pipeline per frame

### Steg 1: välj mode

Regler:
- `slide_chase` om player state är `crouch_slide` eller `stomach_slide`
- `behind_move` bara för explicita future states eller explicit assist/recenter-mode
- annars `default_chase`

Hysteresis:
- byte in i `slide_chase` först efter cirka `60-100ms` stabil slide-state
- byte ut först efter cirka `100-150ms` utanför slide-state
- detta för att undvika fladder

### Steg 2: lös goal yaw

#### `default_chase`
- `baseYawGoal = player.facing + PI`
- om spelaren springer tydligt och ingen manuell input nyligen: gå bestämt mot `baseYawGoal`
- om spelaren nästan står still: bevara mer av nuvarande vinkel, men låt kameran långsamt settle:a bakom
- om kameran är för nära kroppen eller har dålig sikt: höj reclaim/aggressivitet temporärt

Heuristik:
- `movingFast = horizSpeed > 1.2`
- `manualRecent = timeSinceManual < 0.8..1.2s`
- `bigDrift = abs(angleDiff(cameraYaw, baseYawGoal)) > 0.35..0.5 rad`

Beteende:
- om `movingFast && !manualRecent && bigDrift`: approach yaw mot bakom-spelaren
- om `!movingFast`: approach långsamt, inte nollställ direkt
- om `recenter` explicit trycks: snabb transition på `8-12` frames eller `120-180ms`

#### `slide_chase`
- `baseYawGoal = player.facing + PI`
- om slide-velocity är mycket starkare än facing kan velocity få hjälpa till, men facing ska fortfarande väga tungt
- yaw ska låsa bakom snabbare än i `default_chase`

### Steg 3: occlusion solve

Det här är den viktigaste skillnaden mot nuvarande `skyhop`.

Primär strategi:
- testa line-of-sight från fokus till tänkt kameraposition
- om blockerad: sök bättre yaw runt spelaren i diskreta steg

Sökordning:
- `currentYaw`
- `baseYawGoal`
- `baseYawGoal ± 22.5°`
- `baseYawGoal ± 45°`
- `baseYawGoal ± 67.5°`
- `baseYawGoal ± 90°`

Välj första vinkel som:
- ger fri eller klart bättre sikt
- inte placerar kameran långt framför spelaren
- inte kräver absurd distanskollaps

Om yaw-search hittar lösning:
- sätt `occlusionYawBias`
- håll den kort, t.ex. `0.25-0.4s`, så kameran inte flip-floppar varje frame

Sekundär strategi:
- först om yaw-search misslyckas: shrinka distansen
- shrink ska ha floor, men vara sista utvägen, inte default

Tertiär strategi:
- om kameran ändå blir för nära: fasa ut spelarens mesh hellre än att låta kroppen fylla skärmen

## 5. Goal distance

Avstånd ska vara state-baserat, inte fart-baserat.

Startvärden i meter:
- `default_chase`: `8.0`
- `slide_chase`: `8.5-9.0`
- `behind_move`: `8.0`
- `close/look`: `3.5`
- `zoomed_out`: `12.0`

Regler:
- ingen kontinuerlig speed-zoom
- ingen speed-FOV-boost
- använd ev. bara diskreta zoomlägen: `close`, `normal`, `zoomed_out`
- mus-wheel kan finnas kvar, men bör helst byta mellan band eller påverka `zoomState`, inte skapa helt fri cinematisk zoom som ny identitet

## 6. Goal pitch

Default ska vara en mild chase-pitch, inte hög orbit.

Heuristik:
- baspitch: lätt nedåt från kameran mot spelaren
- `slide_chase`: något tydligare pitch för att läsa marken
- på slopes: använd en lätt `look_down_slopes`-idé

Praktisk regel:
- sampla golvhöjd lite framför Mario i kamerans bakåtriktning
- om golvet stiger tydligt: pitcha kameran mer nedåt
- om golvet är platt: håll neutral mild pitch

Viktigt:
- pitch ska inte vara en fri mus-kamera-identitet i default-läget
- manuell pitch är override, inte kärnlogik

## 7. Focus-logik

Fokus ska ligga på spelarens kropp/ögonhöjd, men med subtil kompositionshjälp.

Bas:
- `focus = player.position + eyeHeight`
- startvärde `eyeHeight ≈ 1.25m`

Använd lateral pan, inte tydlig forward-lookahead:
- mät skillnaden mellan spelarens facing och kamerans yaw
- pan:a fokus lite åt vänster/höger för att ge bättre framing
- max pan ungefär `20-30%` av aktuell distans, men mycket subtilt i praktik

Undvik:
- tydlig velocity-driven target push framåt
- det ger modern sandbox/action-cam-känsla i stället för `SM64`

Optional senare:
- long jump kan få inverterad pan som i källkoden, men inte nödvändigt i v1

## 8. Vertikal lösning

Kameran måste ha egen höjdlogik. Inte bara `target.y + camHeight`.

Regler:
- håll kameran över relevant golv med margin
- håll den under tak med margin
- vid korta hopp: latcha `stableFocusY` i cirka `150-200ms` så fokus inte bobbar direkt
- vid ledge hang/climb: lyft fokus och kamerans floor target
- vid hanging/pole-liknande states: låt kameran välja mer skyddad vertikal position i stället för att bara följa kroppens y exakt

Prioritet:
1. spelaren ska vara läsbar
2. kameran ska inte slå i golv/tak
3. små y-förändringar ska dämpas

## 9. Smoothing: "osynlig operatör"

Det här är kärnan i Lakitu-känslan.

Bygg två lager:
- solved `goalPos/goalFocus`
- rendered `curPos/curFocus`

`cur` följer `goal` asymmetriskt, inte med samma lerp överallt.

Bra startvärden:
- `focus horizontal follow`: snabbare, t.ex. `0.7-0.85` asymptotic
- `focus vertical follow`: lugnare, t.ex. `0.25-0.35`
- `position horizontal follow`: `0.25-0.35`
- `position vertical follow`: `0.25-0.35`

Effekt:
- fokus reagerar rätt snabbt på vart kameran vill titta
- själva kamerakroppen släpar lite bakom
- resultatet känns filmat, inte mekaniskt fastsatt

## 10. Manual input policy

Spelaren ska kunna påverka kameran, men inte förvandla den till en annan art.

Regler:
- drag/mus ändrar främst `modeOffsetYaw`, inte absolut frikopplad kameraitet för alltid
- efter `~0.8-1.2s` utan input börjar kameran reclaim:a komposition
- små nudges ska vara tillfälliga
- explicit recenter ska vara snabb och tydlig
- på mobil kan recenter-knapp vara viktigare än full fri orbit

Optional:
- lab/debug mode kan ha fri orbit
- play mode ska ha den opinionsdrivna kameran som default

## 11. Mode-byten och transitions

Övergångar ska vara riktiga transitions, inte bara plötsliga parameterbyten.

Praktiska övergångar:
- `default -> slide_chase`: `8-12` frames snabb operator-omställning
- `slide_chase -> default`: lite långsammare `10-15` frames
- `manual recenter`: `8-10` frames
- `look mode enter/exit`: `12-15` frames

Under transition:
- blend:a polar coords eller `goalPos/goalFocus`
- behåll sikt och floor clamps under hela transitionen

## 12. Vad som uttryckligen bör bort eller tonas ned i skyhop

Om målet är `SM64`-känsla bör detta inte vara primärlogik:
- free orbit som standardidentitet
- velocity look-ahead framåt
- speed-based FOV
- speed-based distance boost
- enkel ray shrink som huvudlösning på occlusion
- för aggressiv kamerarespons på små hopp och små riktningsändringar

## 13. Rekommenderad v1-implementation i skyhop

### Fas A: struktur
- inför `CameraMode`
- inför `goalPos/goalFocus` och `curPos/curFocus`
- inför `modeOffsetYaw`, `panDistance`, `zoomState`, `occlusionYawBias`

### Fas B: default chase
- ersätt nuvarande velocity-lookahead med lateral pan
- gör bakom-facing till huvudintention
- bygg reclaim-logik efter manuell input
- ta bort speed FOV/dist helt i M64-mode

### Fas C: occlusion
- implementera yaw-search runt spelaren
- låt shrink vara fallback
- lägg till mesh-fade när kamera ändå blir för nära

### Fas D: slide chase + vertical solving
- separat slide-heuristik
- floor/ceil-ledgedriven höjdlogik
- short-hop Y stabilization

## 14. Acceptance tests

Kameran är nära rätt när följande känns sant:

1. Spring rakt fram.
   Kameran settle:ar bakom spelaren inom ungefär en sekund utan att kännas autopilot-irriterande.

2. Gör små hopp i följd.
   Kameran bobbar inte upp/ner aggressivt på varje hopp.

3. Spring nära en vägg eller pelare.
   Kameran försöker vrida sig runt för att hålla spelaren synlig, inte bara kollapsa rakt in.

4. Stå still nära geometri.
   Kameran kryper inte obehagligt in i kroppen.

5. Gå in i slide.
   Kameran blir tydligare bakom och mer hjälpande, utan att kännas som ett annat spel.

6. Nudga kameran manuellt och släpp.
   Den respekterar inputen en stund, men återtar sedan kompositionen självsäkert.

## 15. Kort sammanfattning

Rätt mål för `skyhop` är inte "lägg till Lakitu som figur", utan:
- dold state machine
- bakom-facing som intention
- operator-lag
- lateral pan
- yaw-avoid före shrink
- state-baserad zoom/dist
- geometry-aware höjd
- assertive reclaim efter manuell input

Det är det som kommer få kameran att kännas `SM64`, även om spelaren aldrig ser en Lakitu.
