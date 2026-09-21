import re
import os

screens_source = [
    ("v2_00_onboarding_welcome", "stitch_screens/v2/00_onboarding_welcome.html"),
    ("v2_00_coach_create_team", "stitch_screens/v2/00_coach_create_team.html"),
    ("v2_00_parent_join_team", "stitch_screens/v2/00_parent_join_team.html"),
    ("v2_01_coach_home", "stitch_screens/v2/01_coach_home.html"),
    ("v2_02_coach_agenda", "stitch_screens/v2/02_coach_agenda.html"),
    ("v2_03_coach_roster", "stitch_screens/v2/03_coach_roster.html"),
    ("v2_04_player_detail", "stitch_screens/v2/04_player_detail.html"),
    ("v2_05_event_hub_normal", "stitch_screens/v2/05_event_hub_normal.html"),
    ("v2_06_event_hub_injury", "stitch_screens/v2/06_event_hub_injury.html"),
    ("v2_07_parent_home", "stitch_screens/v2/07_parent_home.html"),
    ("v2_08_parent_rsvp", "stitch_screens/v2/08_parent_rsvp.html"),
    ("screen_c_create_event", "stitch_screens/screen_c_create_event.html"),
    ("screen_e_create_squad", "stitch_screens/screen_e_create_squad.html"),
    ("screen_k_notices", "stitch_screens/screen_k_notices.html"),
]

screens_html = {}
for sid, file_path in screens_source:
    raw = open(file_path, "r", encoding="utf-8").read()
    bm = re.search(r'<body[^>]*>(.*?)</body>', raw, re.DOTALL)
    if bm:
        content = bm.group(1)
        # Strip script tags
        content = re.sub(r'<script.*?</script>', '', content, flags=re.DOTALL)
        # Strip internal bottom navs to prevent duplicate bars
        content = re.sub(r'<nav[^>]*>.*?</nav>', '', content, flags=re.DOTALL)
        screens_html[sid] = content.strip()

# =========================================================================
# GLOBAL TEXT REPLACEMENTS: DATES (2026/27) & REMOVAL OF MEDICAL SCOPE CREEP
# =========================================================================
global_scrubs = [
    ("2024/25", "2026/27"),
    ("24/25", "26/27"),
    ("Fútbol Base Federado", "Fútbol Base · Cantera"),
    ("Demo federada activa", "Demo activa"),
    ("2024 / 2025", "2026 / 2027"),
    ("2024-2025", "2026-2027"),
    ("Temporada 2024/2025", "Temporada 2026/2027"),
    ("Temporada 2024/25", "Temporada 2026/27"),
    ("Jueves 17 de Septiembre", "Jueves 17 de Septiembre 2026"),
    ("Baja médica en la convocatoria", "Cambio de asistencia en la convocatoria"),
    ("Baja médica (Esguince leve)", "No disponible (Nota: Está enfermo)"),
    ("ha reportado una baja médica.", "no puede asistir (nota familiar: está enfermo)."),
    ("ha reportado una baja médica", "no puede asistir (nota familiar: está enfermo)"),
    ("Baja médica", "No disponible"),
    ("baja médica", "no disponible"),
    ("Esguince de tobillo leve", "No disponible (está enfermo)"),
    ("Esguince leve de tobillo (Grado I) en sesión de entrenamiento escolar.", "No puede asistir este fin de semana (está enfermo)."),
    ("Esguince leve de tobillo", "No disponible (está enfermo)"),
    ("Plantilla correctora bota der. · Esguince leve de tobillo", "No disponible (nota: está enfermo)"),
    ("Fichas médicas al día (100%)", "Plantilla al día (18 jugadores)"),
    ("Ficha Médica y Seguro", "Datos de Contacto"),
    ("Ficha Médica:", "Disponibilidad:"),
    ("Ficha médica:", "Disponibilidad:"),
    ("Fichas federativas y seguro escolar en regla (18/18)", "Plantilla completa para el evento (18 jugadores)"),
    ("importados de la ficha federativa", "cargados en la plantilla del equipo"),
    ("acta federativa", "convocatoria del partido"),
    ("spam federativo", "mensajes innecesarios"),
    ("Soporte Federativo", "Soporte de Cantera"),
    ("Federación Alavesa", "S. D. Indautxu Cantera"),
    ("Seguro federativo de Álava", "Contacto familiar registrado"),
    ("Seguro escolar Álava", "Contacto familiar registrado"),
    ("seguro escolar en vigor", "contacto familiar verificado"),
    ("Seguro escolar en vigor", "Contacto familiar verificado"),
    ("detalles médicos, agenda y convocatorias", "agenda, convocatorias y avisos"),
    ("Rol Legal", "Rol Familiar"),
    ("Tutor Legal", "Tutor / Familiar"),
    ("Acceso legal concedido", "Acceso concedido"),
    ("Validación por el cuerpo técnico", "Validación del entrenador"),
    ("RGPD Cantera", "Privacidad del Menor"),
    ("no puede asistir por fiebre", "no puede asistir (nota: está enfermo)"),
    ("Incidencia Médica Activa", "Incidencia de Convocatoria Activa"),
    ("Alerta Médica de Alta Importancia Operativa", "Estado Semanal de Disponibilidad"),
    ("Datos de Emergencia y Médicos", "Datos de Contacto"),
    ("Abriendo selector de estado médico", "Abriendo selector de disponibilidad"),
    ("Medical Context & Report Info", "Contexto de Asistencia"),
    ("Quick Medical / Roster Toggle Action", "Acción de Disponibilidad"),
    ("Quórum Federación", "Convocatoria del Partido"),
    ("QUÓRUM FEDERACIÓN", "CONVOCATORIA"),
    ("Nº Licencia: FV-2011-8942", "S. D. Indautxu Infantil A")
]

for sid in screens_html:
    for old, new in global_scrubs:
        screens_html[sid] = screens_html[sid].replace(old, new)
    screens_html[sid] = re.sub(r'data-icon=[\'"]medical_services[\'"]', 'data-icon="event_busy"', screens_html[sid])
    screens_html[sid] = re.sub(r'>medical_services<', '>event_busy<', screens_html[sid])

# =========================================================================
# INJECT INTERACTIVE TRIGGERS & SIMPLIFICATIONS
# =========================================================================

# --- 0. Screen V2-00: Onboarding Welcome ---
screens_html["v2_00_onboarding_welcome"] = re.sub(
    r'(<a aria-label="Entrar como entrenador o staff"[^>]*>)',
    r'<a aria-label="Entrar como entrenador o staff" onclick="teamApp.goToScreen(\'v2_00_coach_create_team\')" class="group relative bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/50 shadow-sm hover:border-primary-container active:scale-[0.98] transition-all duration-150 flex flex-col justify-between gap-3 text-left cursor-pointer" role="button">',
    screens_html["v2_00_onboarding_welcome"]
)
screens_html["v2_00_onboarding_welcome"] = re.sub(
    r'(<a aria-label="Entrar como padre, madre o tutor"[^>]*>)',
    r'<a aria-label="Entrar como padre, madre o tutor" onclick="teamApp.goToScreen(\'v2_00_parent_join_team\')" class="group relative bg-surface-container-lowest p-4 rounded-2xl border border-outline-variant/50 shadow-sm hover:border-secondary active:scale-[0.98] transition-all duration-150 flex flex-col justify-between gap-3 text-left cursor-pointer" role="button">',
    screens_html["v2_00_onboarding_welcome"]
)

# --- 0. Screen V2-00: Coach Create Team (SIMPLIFIED: 3 Core Inputs) ---
screens_html["v2_00_coach_create_team"] = re.sub(
    r'(<button aria-label="Volver"[^>]*>)',
    r'<button aria-label="Volver" onclick="teamApp.goToScreen(\'v2_00_onboarding_welcome\')" class="w-9 h-9 flex items-center justify-center rounded-full hover:bg-surface-container active:scale-[0.98] transition-transform text-on-surface cursor-pointer" type="button">',
    screens_html["v2_00_coach_create_team"],
    count=1
)
screens_html["v2_00_coach_create_team"] = re.sub(
    r'(<button class="[^"]*bg-\[#16a34a\][^"]*")',
    r'\1 onclick="teamApp.shareInviteCode()" style="cursor:pointer;"',
    screens_html["v2_00_coach_create_team"],
    count=1
)
screens_html["v2_00_coach_create_team"] = re.sub(
    r'(<button class="[^"]*bg-primary-container[^"]*>\s*<span>Ir a la mesa del entrenador</span>)',
    r'<button onclick="teamApp.finishCoachSetup()" class="w-full h-[52px] bg-primary-container hover:bg-primary text-on-primary rounded-xl font-label-lg text-label-lg font-bold flex items-center justify-center gap-2 shadow-md active:scale-[0.98] transition-all cursor-pointer" type="button"><span>Ir a la mesa del entrenador</span>',
    screens_html["v2_00_coach_create_team"],
    count=1
)
screens_html["v2_00_coach_create_team"] = re.sub(
    r'onclick="copyCodeFeedback\(this\)"',
    r'onclick="teamApp.copyInviteCode(this)"',
    screens_html["v2_00_coach_create_team"]
)

# --- 0. Screen V2-00: Parent Join Team (PRIVACY FIRST) ---
screens_html["v2_00_parent_join_team"] = re.sub(
    r'(<button aria-label="Volver"[^>]*>)',
    r'<button aria-label="Volver" onclick="teamApp.goToScreen(\'v2_00_onboarding_welcome\')" class="inline-flex items-center gap-1 text-on-surface-variant font-label-md text-label-md hover:text-primary transition-colors py-1 -ml-1 active:scale-[0.98] cursor-pointer" type="button">',
    screens_html["v2_00_parent_join_team"],
    count=1
)
screens_html["v2_00_parent_join_team"] = re.sub(
    r'(<button class="[^"]*id="btn-submit"[^>]*>)',
    r'<button id="btn-submit" onclick="teamApp.submitParentJoinRequest()" class="w-full h-[52px] bg-primary-container hover:bg-primary text-on-primary rounded-xl font-label-lg text-label-lg flex items-center justify-center gap-2 active:scale-[0.98] transition-all shadow-md cursor-pointer" type="button">',
    screens_html["v2_00_parent_join_team"]
)
screens_html["v2_00_parent_join_team"] = screens_html["v2_00_parent_join_team"].replace(
    'class="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none"',
    'class="sticky bottom-0 z-40 bg-surface-container-lowest/98 backdrop-blur border-t border-outline-variant p-4 space-y-2.5 shadow-md"'
).replace(
    'class="w-full max-w-[420px] pointer-events-auto bg-surface-container-lowest/98 backdrop-blur border-t border-outline-variant px-margin-mobile pt-3 pb-6 shadow-[0_-8px_24px_-4px_rgba(15,23,42,0.12)] space-y-2.5"',
    'class="w-full space-y-2"'
)

# --- 1. Screen V2-01: Coach Home with Startup Progress Card ---
coach_startup_banner = """
<!-- PUESTA EN MARCHA TEMPORAL DEL EQUIPO (ONBOARDING PROGRESS) -->
<section id="coach-onboarding-banner" class="bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-primary/25 rounded-2xl p-4 shadow-sm space-y-3.5 relative overflow-hidden">
  <div class="flex items-center justify-between pb-2 border-b border-primary/15">
    <div class="flex items-center gap-2">
      <span class="w-2.5 h-2.5 rounded-full bg-primary animate-pulse"></span>
      <h2 class="font-label-lg text-label-lg text-primary font-extrabold uppercase tracking-wide">Puesta en marcha del equipo</h2>
    </div>
    <span class="px-2 py-0.5 rounded-full bg-primary/10 text-primary font-label-sm text-label-sm font-bold">Código: INDA16</span>
  </div>

  <!-- Metric Strip -->
  <div class="grid grid-cols-3 gap-2 text-center">
    <div class="bg-white/90 rounded-xl p-2 border border-primary/10 shadow-xs">
      <span class="font-extrabold text-base text-on-surface block leading-tight">18</span>
      <span class="text-[10px] text-on-surface-variant font-medium">Jugadores</span>
    </div>
    <div class="bg-white/90 rounded-xl p-2 border border-primary/10 shadow-xs">
      <span id="coach-linked-count" class="font-extrabold text-base text-secondary block leading-tight">12</span>
      <span class="text-[10px] text-on-surface-variant font-medium">Vinculadas</span>
    </div>
    <div class="bg-white/90 rounded-xl p-2 border border-primary/10 shadow-xs">
      <span id="coach-pending-count" class="font-extrabold text-base text-amber-600 block leading-tight">6</span>
      <span class="text-[10px] text-on-surface-variant font-medium">Pendientes</span>
    </div>
  </div>

  <!-- Pending approval request card (Privacy Protected) -->
  <div id="coach-pending-approval-card" class="bg-white rounded-xl p-3 border-2 border-amber-300 shadow-xs space-y-2.5">
    <div class="flex items-start gap-2.5">
      <div class="w-8 h-8 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
        <span class="material-symbols-outlined text-[18px]">person_add</span>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between">
          <span class="font-label-sm text-label-sm text-amber-800 font-bold uppercase tracking-wider">Solicitud de vinculación</span>
          <span class="text-[10px] text-slate-400">Hace 5 min</span>
        </div>
        <p class="font-label-md text-label-md text-on-surface font-bold mt-0.5 leading-snug">
          Elena Gómez <span class="font-normal text-on-surface-variant text-xs">solicita vincularse como tutora de</span> Ibai Aranguren (#9)
        </p>
      </div>
    </div>
    <!-- Quick actions -->
    <div class="grid grid-cols-2 gap-2 pt-1 border-t border-slate-100">
      <button onclick="teamApp.rejectGuardianRequest()" class="h-9 rounded-lg border border-outline-variant bg-surface-container-low hover:bg-surface-container text-on-surface-variant font-label-md text-label-md font-medium flex items-center justify-center cursor-pointer active:scale-[0.98]">
        Rechazar
      </button>
      <button onclick="teamApp.approveGuardianRequest()" class="h-9 rounded-lg bg-secondary hover:bg-emerald-700 text-white font-label-md text-label-md font-bold flex items-center justify-center gap-1 shadow-xs cursor-pointer active:scale-[0.98]">
        <span class="material-symbols-outlined text-[16px]">check</span>
        Aceptar
      </button>
    </div>
  </div>

  <!-- Approved confirmation badge -->
  <div id="coach-approval-success-badge" class="hidden bg-emerald-50 border border-emerald-300 rounded-xl p-3 flex items-center gap-2.5 text-emerald-900">
    <span class="material-symbols-outlined text-secondary text-[22px]">verified</span>
    <div class="text-xs leading-tight">
      <strong>Elena Gómez vinculada a Ibai Aranguren (#9)</strong><br>
      <span class="text-emerald-700">Acceso concedido. Notificación enviada a la familia.</span>
    </div>
  </div>

  <!-- Share invite again button -->
  <div class="flex gap-2">
    <button onclick="teamApp.shareInviteCode()" class="flex-1 h-10 bg-white hover:bg-surface-container-low border border-primary/30 text-primary font-label-md text-label-md font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-xs cursor-pointer active:scale-[0.98]">
      <span class="material-symbols-outlined text-[18px]">share</span>
      <span>Compartir invitación (INDA16)</span>
    </button>
    <button onclick="teamApp.dismissOnboardingBanner()" class="h-10 px-3 bg-surface-container-high hover:bg-surface-container text-on-surface-variant rounded-xl text-xs font-semibold cursor-pointer" title="Ocultar puesta en marcha (Equipo rodado)">
      Ocultar
    </button>
  </div>
</section>
"""

screens_html["v2_01_coach_home"] = screens_html["v2_01_coach_home"].replace(
    "<!-- SECTION 1: 'HOY' (Immediate operational focus) -->",
    coach_startup_banner + "\n<!-- SECTION 1: 'HOY' (Immediate operational focus) -->"
)

# Interactivity on Coach Home
screens_html["v2_01_coach_home"] = re.sub(
    r'(<button class="[^"]*border-2 border-tertiary text-tertiary[^"]*")',
    r'\1 onclick="teamApp.goToScreen(\'v2_06_event_hub_injury\', \'agenda\')" style="cursor:pointer;"',
    screens_html["v2_01_coach_home"],
    count=1
)
screens_html["v2_01_coach_home"] = re.sub(
    r'(<button class="[^"]*rounded-xl bg-primary-container[^"]*fact_check[^"]*")',
    r'\1 onclick="teamApp.showToast(\'✓ Lista de asistencia guardada: 16 de 18 jugadores presentes hoy.\')" style="cursor:pointer;"',
    screens_html["v2_01_coach_home"],
    count=1
)
screens_html["v2_01_coach_home"] = re.sub(
    r'(<button class="[^"]*rounded-xl bg-primary-container[^"]*>\s*<span[^>]*data-icon="send">send</span>\s*Revisar\s*</button>)',
    r'<button onclick="teamApp.goToScreen(\'v2_05_event_hub_normal\', \'agenda\')" class="w-full h-[50px] rounded-xl bg-primary-container hover:bg-primary active:scale-[0.98] transition-all text-on-primary font-label-lg text-label-lg font-bold flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"><span class="material-symbols-outlined text-[18px]" data-icon="send">send</span> Revisar</button>',
    screens_html["v2_01_coach_home"],
    count=1
)
screens_html["v2_01_coach_home"] = re.sub(
    r'(<button class="[^"]*rounded-xl bg-primary-container[^"]*>\s*<span[^>]*data-icon="playlist_add_check">playlist_add_check</span>\s*Preparar convocatoria\s*</button>)',
    r'<button onclick="teamApp.goToScreen(\'screen_e_create_squad\', \'agenda\')" class="w-full h-[50px] rounded-xl bg-primary-container hover:bg-primary active:scale-[0.98] transition-all text-on-primary font-label-lg text-label-lg font-bold flex items-center justify-center gap-1.5 shadow-sm cursor-pointer"><span class="material-symbols-outlined text-[18px]" data-icon="playlist_add_check">playlist_add_check</span> Preparar convocatoria</button>',
    screens_html["v2_01_coach_home"],
    count=1
)

# --- 2. Screen V2-02: Coach Agenda ---
screens_html["v2_02_coach_agenda"] = re.sub(
    r'(<button class="[^"]*bg-primary-container[^"]*">\s*<span[^>]*>add</span>\s*<span>Crear evento</span>\s*</button>)',
    r'<button id="agenda-create-event-btn" onclick="teamApp.goToScreen(\'screen_c_create_event\', \'agenda\')" class="h-10 px-3.5 bg-primary-container hover:bg-primary text-on-primary font-label-md text-label-md rounded-xl flex items-center gap-1.5 shadow-sm active:scale-[0.98] transition-transform shrink-0 cursor-pointer"><span class="material-symbols-outlined text-[18px]">add</span><span>Crear evento</span></button>',
    screens_html["v2_02_coach_agenda"],
    count=1
)
screens_html["v2_02_coach_agenda"] = re.sub(
    r'(<button class="[^"]*bg-surface-container-high[^"]*">\s*<span[^>]*>checklist</span>\s*<span>Pasar lista</span>\s*</button>)',
    r'<button onclick="teamApp.showToast(\'✓ Asistencia registrada: 16 jugadores presentes en el entrenamiento de hoy.\')" class="h-11 rounded-xl bg-surface-container-high hover:bg-surface-container text-on-surface font-label-md text-label-md flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform cursor-pointer"><span class="material-symbols-outlined text-[18px]">checklist</span><span>Pasar lista</span></button>',
    screens_html["v2_02_coach_agenda"],
    count=1
)
screens_html["v2_02_coach_agenda"] = re.sub(
    r'(<button class="[^"]*bg-primary[^"]*">\s*<span[^>]*>sports_soccer</span>\s*<span>Ver sesión</span>\s*</button>)',
    r'<button onclick="teamApp.showToast(\'Sesión #14: Rondo de posesión 6x2 + repliegue defensivo.\')" class="h-11 rounded-xl bg-primary hover:bg-primary-container text-on-primary font-label-md text-label-md flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform cursor-pointer"><span class="material-symbols-outlined text-[18px]">sports_soccer</span><span>Ver sesión</span></button>',
    screens_html["v2_02_coach_agenda"],
    count=1
)
screens_html["v2_02_coach_agenda"] = re.sub(
    r'(<button class="[^"]*bg-primary-container[^"]*">\s*<span[^>]*>manage_accounts</span>\s*<span>Gestionar evento</span>\s*</button>)',
    r'<button id="agenda-card2-coach-btn" onclick="teamApp.goToScreen(\'v2_06_event_hub_injury\', \'agenda\')" class="h-12 w-full bg-primary-container hover:bg-primary text-on-primary font-label-lg text-label-lg rounded-xl flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] transition-transform mt-1 cursor-pointer"><span class="material-symbols-outlined text-[20px]">manage_accounts</span><span>Gestionar evento</span></button><button id="agenda-card2-parent-btn" onclick="teamApp.goToScreen(\'v2_08_parent_rsvp\', \'agenda\')" class="hidden h-12 w-full bg-primary-container hover:bg-primary text-on-primary font-label-lg text-label-lg rounded-xl flex items-center justify-center gap-2 shadow-sm active:scale-[0.98] transition-transform mt-1 cursor-pointer"><span class="material-symbols-outlined text-[20px]">how_to_reg</span><span>Ver convocatoria y responder</span></button>',
    screens_html["v2_02_coach_agenda"],
    count=1
)
screens_html["v2_02_coach_agenda"] = re.sub(
    r'(<button class="[^"]*bg-surface-container-high[^"]*">\s*<span[^>]*>campaign</span>\s*<span>Recordar a familias</span>\s*</button>)',
    r'<button id="agenda-card3-coach-action" onclick="teamApp.showToast(\'🔔 Recordatorio de respuestas enviado a las familias para el lunes.\')" class="h-11 w-full bg-surface-container-high hover:bg-surface-container text-primary font-label-md text-label-md rounded-xl flex items-center justify-center gap-2 border border-outline-variant/50 active:scale-[0.98] transition-transform cursor-pointer"><span class="material-symbols-outlined text-[18px]">campaign</span><span>Recordar a familias</span></button>',
    screens_html["v2_02_coach_agenda"],
    count=1
)

# --- 3. Screen V2-03: Coach Roster ---
screens_html["v2_03_coach_roster"] = re.sub(
    r'(<button class="whitespace-nowrap px-3.5 py-1.5 rounded-full bg-primary text-on-primary[^"]*">\s*Todos \(18\)\s*</button>)',
    r'<button onclick="teamApp.filterRoster(\'all\')" class="whitespace-nowrap px-3.5 py-1.5 rounded-full bg-primary text-on-primary font-label-md text-label-md shadow-xs cursor-pointer">Todos (18)</button>',
    screens_html["v2_03_coach_roster"]
)
screens_html["v2_03_coach_roster"] = re.sub(
    r'(<button class="whitespace-nowrap px-3.5 py-1.5 rounded-full bg-surface-container-lowest[^"]*">\s*Disponibles \(15\)\s*</button>)',
    r'<button onclick="teamApp.filterRoster(\'disponibles\')" class="whitespace-nowrap px-3.5 py-1.5 rounded-full bg-surface-container-lowest border border-outline-variant text-on-surface-variant font-label-md text-label-md hover:bg-surface-container-high cursor-pointer">Disponibles (15)</button>',
    screens_html["v2_03_coach_roster"]
)
screens_html["v2_03_coach_roster"] = re.sub(
    r'(<button class="whitespace-nowrap px-3.5 py-1.5 rounded-full bg-surface-container-lowest[^"]*">\s*Convocados \(11\)\s*</button>)',
    r'<button onclick="teamApp.filterRoster(\'convocados\')" class="whitespace-nowrap px-3.5 py-1.5 rounded-full bg-surface-container-lowest border border-outline-variant text-on-surface-variant font-label-md text-label-md hover:bg-surface-container-high cursor-pointer">Convocados (11)</button>',
    screens_html["v2_03_coach_roster"]
)
screens_html["v2_03_coach_roster"] = re.sub(
    r'(<button class="whitespace-nowrap px-3.5 py-1.5 rounded-full bg-surface-container-lowest[^"]*">\s*Bajas \(3\)\s*</button>)',
    r'<button onclick="teamApp.filterRoster(\'bajas\')" class="whitespace-nowrap px-3.5 py-1.5 rounded-full bg-surface-container-lowest border border-outline-variant text-on-surface-variant font-label-md text-label-md hover:bg-surface-container-high cursor-pointer">No disponibles (3)</button>',
    screens_html["v2_03_coach_roster"]
)

# Connect Ibai row to Player Detail
screens_html["v2_03_coach_roster"] = re.sub(
    r'(<div class="flex items-center gap-3">\s*<div class="w-10 h-10 rounded-full bg-tertiary-container[^>]*>09</div>\s*<div>\s*<h3 class="font-headline-sm text-headline-sm text-on-surface[^>]*>Ibai Aranguren</h3>)',
    r'<div onclick="teamApp.goToScreen(\'v2_04_player_detail\', \'equipo\')" class="cursor-pointer hover:bg-slate-50 p-1.5 rounded-xl transition-colors">\1',
    screens_html["v2_03_coach_roster"],
    count=1
)

# --- 4. Screen V2-04: Player Detail ---
screens_html["v2_04_player_detail"] = re.sub(
    r'(<button aria-label="Volver"[^>]*>)',
    r'<button aria-label="Volver" onclick="teamApp.goToScreen(\'v2_03_coach_roster\', \'equipo\')" class="p-2 -ml-2 rounded-full text-on-surface hover:bg-surface-container transition-colors cursor-pointer" type="button">',
    screens_html["v2_04_player_detail"],
    count=1
)
screens_html["v2_04_player_detail"] = re.sub(
    r'(<a class="w-10 h-10 rounded-xl bg-surface-container[^"]*href="tel:620445566"[^>]*>)',
    r'<a class="w-10 h-10 rounded-xl bg-surface-container text-primary flex items-center justify-center hover:bg-primary-fixed cursor-pointer transition-colors" href="tel:620445566" onclick="teamApp.showToast(\'Llamando a Elena Gómez (Madre de Ibai)... 620 44 55 66\')">',
    screens_html["v2_04_player_detail"],
    count=1
)

# --- 5. Screen V2-05: Event Hub Normal ---
screens_html["v2_05_event_hub_normal"] = re.sub(
    r'(<button class="[^"]*text-primary border border-outline-variant[^"]*">\s*<span[^>]*>send</span>\s*<span>Recordar a pendientes \(2\)</span>\s*</button>)',
    r'<button onclick="teamApp.nudgePending()" class="h-11 px-4 rounded-xl border border-primary text-primary hover:bg-primary hover:text-white font-label-md text-label-md flex items-center gap-2 active:scale-[0.98] transition-transform cursor-pointer"><span class="material-symbols-outlined text-[18px]">send</span><span>Recordar a pendientes (2)</span></button>',
    screens_html["v2_05_event_hub_normal"]
)
screens_html["v2_05_event_hub_normal"] = re.sub(
    r'(<button class="[^"]*bg-primary-container[^"]*">\s*<span>Ver convocatoria \(12\)</span>\s*</button>)',
    r'<button onclick="teamApp.goToScreen(\'v2_06_event_hub_injury\', \'agenda\')" class="h-11 px-5 rounded-xl bg-primary-container hover:bg-primary text-on-primary font-label-md text-label-md flex items-center gap-1.5 shadow-sm active:scale-[0.98] transition-transform cursor-pointer"><span>Ver convocatoria (12)</span></button>',
    screens_html["v2_05_event_hub_normal"]
)

# --- 6. Screen V2-06: Event Hub Injury (Neutral Substitute Treatment) ---
screens_html["v2_06_event_hub_injury"] = re.sub(
    r'(<div class="player-card relative [^"]*onclick="selectPlayer\(\'cand-ane\'\)"[^>]*>)',
    r'<div id="sub-card-ane" class="player-card relative bg-surface-container-lowest border-2 border-primary-container rounded-2xl p-4 shadow-sm flex items-center justify-between cursor-pointer active:scale-[0.99] transition-all" onclick="teamApp.selectReserve(\'Ane Mintegi\')">',
    screens_html["v2_06_event_hub_injury"]
)
screens_html["v2_06_event_hub_injury"] = re.sub(
    r'(<div class="player-card relative [^"]*onclick="selectPlayer\(\'cand-nahia\'\)"[^>]*>)',
    r'<div id="sub-card-nahia" class="player-card relative bg-surface-container-lowest border border-outline-variant rounded-2xl p-4 shadow-xs flex items-center justify-between cursor-pointer active:scale-[0.99] transition-all" onclick="teamApp.selectReserve(\'Nahia Garcia\')">',
    screens_html["v2_06_event_hub_injury"]
)
screens_html["v2_06_event_hub_injury"] = re.sub(
    r'(<div class="player-card relative [^"]*onclick="selectPlayer\(\'cand-irati\'\)"[^>]*>)',
    r'<div id="sub-card-irati" class="player-card relative bg-surface-container-lowest border border-outline-variant rounded-2xl p-4 shadow-xs flex items-center justify-between cursor-pointer active:scale-[0.99] transition-all" onclick="teamApp.selectReserve(\'Irati Fernandez\')">',
    screens_html["v2_06_event_hub_injury"]
)
screens_html["v2_06_event_hub_injury"] = re.sub(
    r'(<button class="w-full h-12 bg-primary-container[^"]*")',
    r'<button onclick="teamApp.confirmSubstitution()" class="w-full h-12 bg-primary-container hover:bg-primary active:scale-[0.98] transition-all text-on-primary font-label-lg text-label-lg font-bold rounded-xl flex items-center justify-center gap-2 shadow-sm cursor-pointer"',
    screens_html["v2_06_event_hub_injury"],
    count=1
)

# --- 7. Screen V2-07: Parent Home ---
screens_html["v2_07_parent_home"] = re.sub(
    r'(<button class="[^"]*bg-primary-container[^"]*>\s*<span>Responder disponibilidad</span>\s*</button>)',
    r'<button onclick="teamApp.goToScreen(\'v2_08_parent_rsvp\', \'inicio\')" class="w-full h-[52px] bg-primary-container hover:bg-primary text-on-primary font-label-lg text-label-lg rounded-xl flex items-center justify-center gap-2 shadow-md active:scale-[0.98] transition-all cursor-pointer"><span>Responder disponibilidad</span></button>',
    screens_html["v2_07_parent_home"],
    count=1
)

# --- 8. Screen V2-08: Parent RSVP ---
screens_html["v2_08_parent_rsvp"] = re.sub(
    r'(<button aria-label="Volver atrás"[^>]*>)',
    r'<button aria-label="Volver atrás" onclick="teamApp.goToScreen(\'v2_07_parent_home\', \'inicio\')" class="w-9 h-9 rounded-full bg-surface-container-low flex items-center justify-center text-on-surface-variant hover:bg-surface-container transition-colors cursor-pointer" type="button">',
    screens_html["v2_08_parent_rsvp"]
)
screens_html["v2_08_parent_rsvp"] = re.sub(
    r'(<button id="save-btn"[^>]*>)',
    r'<button id="save-btn" onclick="triggerSaveFeedback(); teamApp.saveParentRsvp();" class="w-full h-[52px] rounded-xl bg-primary-container hover:bg-[#1e40af] active:bg-[#173cb0] active:scale-[0.98] text-white font-label-lg text-label-lg font-bold flex items-center justify-center gap-2 shadow-md transition-all duration-150 cursor-pointer" type="button">',
    screens_html["v2_08_parent_rsvp"]
)

# --- 9. Screen C: Create Event ---
screens_html["screen_c_create_event"] = re.sub(
    r'(<button aria-label="Cerrar"[^>]*>|<button class="[^"]*p-2 rounded-full text-on-surface-variant[^"]*">)',
    r'<button onclick="teamApp.goToScreen(\'v2_02_coach_agenda\', \'agenda\')" class="p-2 rounded-full text-on-surface-variant cursor-pointer">',
    screens_html["screen_c_create_event"],
    count=1
)
screens_html["screen_c_create_event"] = re.sub(
    r'(<button class="[^"]*w-full[^"]*bg-primary-container[^"]*")',
    r'\1 onclick="teamApp.showToast(\'✓ Torneo Apertura creado y disponibilidad solicitada a las 18 familias.\'); teamApp.goToScreen(\'v2_05_event_hub_normal\', \'agenda\');" style="cursor:pointer;"',
    screens_html["screen_c_create_event"],
    count=1
)

# --- 10. Screen E: Create Squad ---
screens_html["screen_e_create_squad"] = re.sub(
    r'(<button class="[^"]*p-2 rounded-full text-on-surface-variant[^"]*")',
    r'\1 onclick="teamApp.goToScreen(\'v2_05_event_hub_normal\', \'agenda\')" style="cursor:pointer;"',
    screens_html["screen_e_create_squad"],
    count=1
)
screens_html["screen_e_create_squad"] = re.sub(
    r'(<button class="[^"]*w-full[^"]*bg-primary-container[^"]*")',
    r'\1 onclick="teamApp.showToast(\'✓ Convocatoria oficial de 12 jugadores publicada.\'); teamApp.goToScreen(\'v2_06_event_hub_injury\', \'agenda\');" style="cursor:pointer;"',
    screens_html["screen_e_create_squad"],
    count=1
)

# --- 11. Screen K: Notices ---
screens_html["screen_k_notices"] = screens_html["screen_k_notices"].replace(
    'Ver convocatoria actualizada →',
    '<span onclick="teamApp.goToScreen(\'v2_06_event_hub_injury\', \'agenda\')" class="cursor-pointer font-bold text-primary hover:underline">Ver convocatoria actualizada →</span>'
)


header_html = """<!DOCTYPE html>
<html lang="es" class="light">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
  <title>Talde Hemendik! · S. D. Indautxu Infantil A (2026/27)</title>
  
  <!-- Material Symbols Google Icons -->
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200"/>
  
  <!-- Plus Jakarta Sans Athletic Font -->
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,400&display=swap" rel="stylesheet"/>
  
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
  <script>
    tailwind.config = {
      darkMode: "class",
      theme: {
        extend: {
          colors: {
            primary: "#0037b0",
            "primary-container": "#1d4ed8",
            "on-primary": "#ffffff",
            "on-primary-container": "#cad3ff",
            "primary-fixed": "#dce1ff",
            "primary-fixed-dim": "#b7c4ff",
            "on-primary-fixed": "#001551",
            "on-primary-fixed-variant": "#0039b5",
            secondary: "#006c4a",
            "secondary-container": "#82f5c1",
            "on-secondary": "#ffffff",
            "on-secondary-container": "#00714e",
            "secondary-fixed": "#85f8c4",
            "secondary-fixed-dim": "#68dba9",
            tertiary: "#8f000b",
            "tertiary-container": "#bb0112",
            "on-tertiary": "#ffffff",
            "on-tertiary-container": "#ffc7c1",
            error: "#ba1a1a",
            "error-container": "#ffdad6",
            "on-error": "#ffffff",
            "on-error-container": "#93000a",
            background: "#faf8ff",
            "on-background": "#131b2e",
            surface: "#faf8ff",
            "on-surface": "#131b2e",
            "surface-variant": "#dae2fd",
            "on-surface-variant": "#434655",
            "surface-container-lowest": "#ffffff",
            "surface-container-low": "#f2f3ff",
            "surface-container": "#eaedff",
            "surface-container-high": "#e2e7ff",
            "surface-container-highest": "#dae2fd",
            outline: "#747686",
            "outline-variant": "#c4c5d7",
            "surface-dim": "#d2d9f4",
            "surface-bright": "#faf8ff",
            "surface-tint": "#2151da",
            "inverse-surface": "#283044",
            "inverse-on-surface": "#eef0ff",
            "inverse-primary": "#b7c4ff",
          },
          fontFamily: {
            sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
          },
          borderRadius: {
            DEFAULT: "0.25rem",
            lg: "0.5rem",
            xl: "0.75rem",
            "2xl": "1rem",
            "3xl": "1.5rem",
            full: "9999px"
          }
        }
      }
    };
  </script>

  <style>
    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      -webkit-tap-highlight-color: transparent;
    }
    .material-symbols-outlined {
      font-variation-settings: 'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24;
      line-height: 1;
      display: inline-block;
      vertical-align: middle;
    }
    .material-symbols-outlined.icon-filled {
      font-variation-settings: 'FILL' 1, 'wght' 600, 'GRAD' 0, 'opsz' 24;
    }
    .no-scrollbar::-webkit-scrollbar {
      display: none;
    }
    .no-scrollbar {
      -ms-overflow-style: none;
      scrollbar-width: none;
    }
    button, a {
      touch-action: manipulation;
    }
  </style>
</head>

<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col items-center select-none overflow-x-hidden p-0 sm:p-2">

  <!-- ======================================================== -->
  <!-- DEMO TOOLBAR & GUIDED TOUR -->
  <!-- ======================================================== -->
  <aside class="w-full max-w-xl mx-auto bg-slate-900 border-b sm:border border-slate-800 sm:rounded-2xl p-2 sm:p-2.5 flex flex-wrap items-center justify-between gap-2 shadow-lg z-50 shrink-0">
    <!-- Brand & Role Switcher -->
    <div class="flex items-center gap-2">
      <div class="flex items-center gap-1.5 font-black text-sm tracking-tight text-blue-400">
        <span class="material-symbols-outlined text-[20px]">sports_soccer</span>
        <span class="hidden xs:inline">Talde Hemendik!</span>
      </div>

      <!-- Multi-team / Multi-role switcher: USUARIO -> EQUIPO -> ROL -->
      <div class="bg-slate-950 p-0.5 rounded-xl border border-slate-800 flex items-center gap-0.5">
        <button id="role-btn-onboard" onclick="teamApp.switchMembership('onboard')" class="px-2 py-1 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 transition-all cursor-pointer">
          Acceso
        </button>
        <button id="role-btn-coach" onclick="teamApp.switchMembership('indautxu_inf_a')" class="px-2 py-1 rounded-lg text-xs font-bold bg-blue-600 text-white shadow-xs transition-all cursor-pointer" title="Mikel Zubeldia · Entrenador S. D. Indautxu Infantil A">
          Infantil A (Míster)
        </button>
        <button id="role-btn-parent" onclick="teamApp.switchMembership('indautxu_ale_b')" class="px-2 py-1 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 transition-all cursor-pointer" title="Elena Gómez · Madre de Ibai #9">
          Familia (Elena)
        </button>
      </div>
    </div>

    <!-- Tour Navigation -->
    <div class="flex items-center gap-1.5">
      <button onclick="teamApp.prevStep()" class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-medium flex items-center gap-0.5 transition-colors cursor-pointer" title="Paso anterior">
        <span class="material-symbols-outlined text-[14px]">arrow_back</span>
        <span class="hidden sm:inline">Ant.</span>
      </button>

      <button onclick="teamApp.nextStep()" class="px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-bold flex items-center gap-0.5 transition-colors cursor-pointer shadow-xs" title="Siguiente paso">
        <span>Sig.</span>
        <span class="material-symbols-outlined text-[14px]">arrow_forward</span>
      </button>

      <!-- Screen Dropdown Direct Jump -->
      <select id="demo-screen-select" onchange="teamApp.goToScreen(this.value)" class="max-w-[130px] sm:max-w-[170px] bg-slate-950 text-slate-200 border border-slate-800 rounded-xl px-2 py-1 text-[11px] sm:text-xs focus:ring-1 focus:ring-blue-500 cursor-pointer text-ellipsis overflow-hidden">
        <option value="v2_00_onboarding_welcome">0. Acceso Inicial</option>
        <option value="v2_00_coach_create_team">0a. Crear Equipo & INDA16</option>
        <option value="v2_00_parent_join_team">0b. Familia: Solicitud Vinculación</option>
        <option value="v2_01_coach_home">1. Inicio (La mesa del míster)</option>
        <option value="v2_02_coach_agenda">2. Agenda Semanal</option>
        <option value="v2_05_event_hub_normal">3. Hub: Disponibilidad Activa</option>
        <option value="v2_06_event_hub_injury">4. Hub: Asistencia & Suplentes Neutros</option>
        <option value="v2_03_coach_roster">5. Plantilla (18 jug.)</option>
        <option value="v2_04_player_detail">6. Ficha de Campo: Ibai (#9)</option>
        <option value="v2_07_parent_home">7. Familia: Inicio</option>
        <option value="v2_08_parent_rsvp">8. Familia: RSVP 3 Segundos</option>
        <option value="screen_c_create_event">Aux: Crear Evento</option>
        <option value="screen_e_create_squad">Aux: Convocatoria</option>
        <option value="screen_k_notices">Aux: Tablón Avisos</option>
      </select>

      <button onclick="toggleTourInfo()" class="p-1.5 text-slate-400 hover:text-slate-200 rounded-lg cursor-pointer shrink-0" title="Ocultar/Mostrar guía">
        <span id="tour-info-icon" class="material-symbols-outlined text-[18px]">expand_less</span>
      </button>

      <button onclick="teamApp.resetDemo()" class="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg cursor-pointer shrink-0" title="Reiniciar toda la demo">
        <span class="material-symbols-outlined text-[18px]">restart_alt</span>
      </button>
    </div>
  </aside>

  <!-- Barra informativa de la etapa guiada -->
  <div id="demo-step-card" class="w-full max-w-xl mx-auto px-2 sm:px-4 mt-1 sm:mt-1.5 transition-all duration-200">
    <div class="bg-slate-900/95 border border-slate-800 rounded-xl p-2.5 sm:p-3 shadow-md">
      <div class="flex items-center justify-between gap-2 mb-1">
        <h2 id="demo-step-title" class="text-xs font-bold text-blue-400">1. Acceso Inicial: ¿Cómo vas a utilizar la app?</h2>
        <span class="text-[10px] text-slate-400 font-mono">11 pasos guiados</span>
      </div>
      <p id="demo-step-desc" class="text-[11px] sm:text-xs text-slate-300 leading-snug">
        Pantalla única de bienvenida para todo el club. El usuario elige su función: 'Soy entrenador / staff' o 'Soy padre, madre o tutor'. Sin apps separadas.
      </p>
      <div class="mt-1.5 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] sm:text-[11px]">
        <div class="text-amber-400 font-medium flex items-center gap-1">
          <span class="material-symbols-outlined text-[13px] sm:text-[14px]">touch_app</span>
          <span id="demo-step-action">Pulsa 'Soy entrenador / staff' para iniciar la creación del equipo.</span>
        </div>
      </div>
      <!-- Barra de progreso lineal -->
      <div class="w-full bg-slate-800 h-1 rounded-full mt-1.5 overflow-hidden">
        <div id="demo-step-progress" class="bg-blue-500 h-full rounded-full transition-all duration-300" style="width: 9%"></div>
      </div>
    </div>
  </div>

  <!-- ======================================================== -->
  <!-- MOBILE DEVICE VIEWPORT CONTAINER (Capacitor Ready) -->
  <!-- ======================================================== -->
  <div class="w-full flex-1 flex items-center justify-center p-0 sm:p-4 my-auto overflow-hidden">
    <div class="mockup-wrapper w-full sm:max-w-[390px] h-[calc(100dvh-125px)] sm:h-[844px] bg-surface rounded-none sm:rounded-[40px] border-0 sm:border-[6px] border-slate-900 flex flex-col relative overflow-hidden text-on-surface shadow-none sm:shadow-2xl">
      
      <!-- Top Smartphone Notch (Only on desktop preview) -->
      <div class="hidden sm:flex w-full h-8 bg-surface-container-lowest items-center justify-between px-6 shrink-0 z-50 select-none border-b border-outline-variant/30">
        <span class="text-[12px] font-bold text-on-surface tracking-tight">18:00</span>
        <div class="w-20 h-4 bg-slate-950 rounded-full mx-auto"></div>
        <div class="flex items-center gap-1.5 text-on-surface text-[12px]">
          <span class="material-symbols-outlined text-[14px]">signal_cellular_4_bar</span>
          <span class="material-symbols-outlined text-[14px]">wifi</span>
          <span class="material-symbols-outlined text-[16px] text-secondary">battery_full</span>
        </div>
      </div>

      <!-- Main Scrollable App Viewport for Screens -->
      <div id="phone-viewport" class="w-full flex-1 overflow-y-auto overflow-x-hidden relative bg-surface pb-16">
"""

footer_html = """
      </div>

      <!-- ======================================================== -->
      <!-- UNIFIED PERSISTENT BOTTOM NAVIGATION BAR -->
      <!-- ======================================================== -->
      <nav id="master-bottom-nav" aria-label="Navegación principal de la app" class="w-full bg-surface-container-lowest border-t border-outline-variant/70 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] flex items-center justify-around px-2 py-1 shrink-0 z-40">
        <button id="nav-tab-inicio" onclick="teamApp.goToTab('inicio')" class="flex-1 flex flex-col items-center justify-center py-1 text-primary font-bold transition-colors cursor-pointer">
          <span class="material-symbols-outlined text-[24px]">home</span>
          <span class="text-[11px] font-bold tracking-tight text-primary">Inicio</span>
        </button>
        <button id="nav-tab-agenda" onclick="teamApp.goToTab('agenda')" class="flex-1 flex flex-col items-center justify-center py-1 text-on-surface-variant hover:text-primary transition-colors cursor-pointer">
          <span class="material-symbols-outlined text-[24px]">calendar_month</span>
          <span class="text-[11px] font-medium tracking-tight">Agenda</span>
        </button>
        <button id="nav-tab-equipo" onclick="teamApp.goToTab('equipo')" class="flex-1 flex flex-col items-center justify-center py-1 text-on-surface-variant hover:text-primary transition-colors cursor-pointer">
          <span id="nav-icon-equipo" class="material-symbols-outlined text-[24px]">groups</span>
          <span id="nav-label-equipo" class="text-[11px] font-medium tracking-tight">Equipo</span>
        </button>
        <button id="nav-tab-avisos" onclick="teamApp.goToTab('avisos')" class="flex-1 flex flex-col items-center justify-center py-1 text-on-surface-variant hover:text-primary transition-colors cursor-pointer relative">
          <span class="material-symbols-outlined text-[24px]">campaign</span>
          <span class="text-[11px] font-medium tracking-tight">Avisos</span>
          <span class="absolute top-1.5 right-6 w-2 h-2 bg-red-500 rounded-full"></span>
        </button>
      </nav>

      <!-- Bottom Smartphone Home Indicator Bar -->
      <div class="w-full h-4 bg-surface-container-lowest flex items-center justify-center shrink-0 z-50 border-t border-outline-variant/20">
        <div class="w-32 h-1 bg-slate-300 rounded-full"></div>
      </div>

    </div>
  </div>

  <!-- ======================================================== -->
  <!-- MODAL: FICHA PROTEGIDA DE JUGADOR (RGPD / MINIMIZACIÓN) -->
  <!-- ======================================================== -->
  <div id="player-detail-sheet" class="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 hidden">
    <div class="bg-white text-slate-900 rounded-t-3xl sm:rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 animate-in fade-in zoom-in duration-200">
      <div class="flex items-center justify-between pb-3 border-b border-slate-100">
        <div class="flex items-center gap-2.5">
          <span id="sheet-player-num" class="w-9 h-9 rounded-full bg-blue-100 text-blue-700 font-extrabold flex items-center justify-center text-sm">#1</span>
          <div>
            <h4 id="sheet-player-name" class="font-bold text-base text-slate-900 leading-tight">Gorka Elejalde</h4>
            <p id="sheet-player-role" class="text-xs text-slate-500">Portero · S. D. Indautxu Infantil A</p>
          </div>
        </div>
        <button onclick="teamApp.closePlayerModal()" class="p-1.5 text-slate-400 hover:text-slate-700 rounded-full cursor-pointer">
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <div class="mt-3 space-y-2.5 text-xs">
        <div class="p-3 bg-blue-50/60 rounded-xl border border-blue-100">
          <span class="font-bold text-blue-800 block mb-0.5">Estado para el Sábado:</span>
          <span id="sheet-player-status" class="text-blue-900 font-medium">Convocado</span>
        </div>

        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <span class="font-bold text-slate-700 block mb-1">Contacto familiar (Acceso para cuerpo técnico):</span>
          <div class="flex items-center justify-between text-slate-800">
            <div>
              <p id="sheet-tutor-name" class="font-semibold text-slate-900">Iker Elejalde (Padre)</p>
              <p id="sheet-tutor-phone" class="font-mono text-slate-600">611 22 33 44</p>
            </div>
            <a id="sheet-tutor-call" href="tel:611223344" class="px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg font-bold flex items-center gap-1 text-[11px]">
              <span class="material-symbols-outlined text-[14px]">call</span> Llamar
            </a>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2 text-[11px]">
          <div class="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
            <span class="text-slate-500 block">Equipación:</span>
            <span class="font-bold text-slate-800">Talla M (Azul Oficial)</span>
          </div>
          <div class="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
            <span class="text-slate-500 block">Temporada:</span>
            <span class="font-bold text-emerald-700">2026/27 (Alta activa)</span>
          </div>
        </div>
      </div>

      <div class="mt-4 pt-2 border-t border-slate-100">
        <button onclick="teamApp.closePlayerModal()" class="w-full h-10 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl cursor-pointer">
          Cerrar ficha
        </button>
      </div>
    </div>
  </div>

  <!-- TOAST REASSURANCE NOTIFICATION -->
  <div id="demo-toast" class="fixed bottom-16 bg-slate-900 text-white border border-blue-500/50 px-4 py-2.5 rounded-xl shadow-2xl text-xs font-semibold z-50 transition-all duration-300 transform opacity-0 pointer-events-none translate-y-2 max-w-md text-center">
    Notificación
  </div>

  <!-- Scripts -->
  <script src="app.js"></script>
  <script>
    function toggleTourInfo() {
      const card = document.getElementById("demo-step-card");
      const icon = document.getElementById("tour-info-icon");
      if (card) {
        card.classList.toggle("hidden");
        if (icon) {
          icon.textContent = card.classList.contains("hidden") ? "expand_more" : "expand_less";
        }
      }
    }

    function selectPlayer(id) {
      const cards = document.querySelectorAll('.player-card');
      cards.forEach(card => {
        const radioSlot = card.querySelector('.radio-slot');
        if (card.id === id) {
          card.classList.remove('border-outline-variant', 'bg-surface-container-lowest');
          card.classList.add('border-primary-container', 'bg-surface-container-high/40', 'border-2');
          if (radioSlot) {
            radioSlot.classList.remove('text-outline');
            radioSlot.classList.add('text-primary');
            radioSlot.innerHTML = `<span class="material-symbols-outlined text-[24px] icon-filled" data-icon="check_circle">check_circle</span>`;
          }
        } else {
          card.classList.remove('border-primary-container', 'bg-surface-container-high/40', 'border-2');
          card.classList.add('border-outline-variant', 'bg-surface-container-lowest');
          if (radioSlot) {
            radioSlot.classList.remove('text-primary');
            radioSlot.classList.add('text-outline');
            radioSlot.innerHTML = `<span class="material-symbols-outlined text-[24px]" data-icon="radio_button_unchecked">radio_button_unchecked</span>`;
          }
        }
      });
    }

    function updateRsvpSelection(type) {
      const yesCard = document.getElementById('rsvp-yes-label');
      const noCard = document.getElementById('rsvp-no-label');
      const maybeCard = document.getElementById('rsvp-maybe-label');

      if (!yesCard || !noCard || !maybeCard) return;

      [yesCard, noCard, maybeCard].forEach(card => {
        card.className = "relative flex items-start gap-3.5 p-3.5 rounded-2xl cursor-pointer border border-outline-variant/60 bg-surface-container-lowest hover:bg-surface-container-low/50 transition-all duration-150 active:scale-[0.98]";
        const radioIndicator = card.querySelector('div:last-child');
        if (radioIndicator) {
          radioIndicator.className = "w-6 h-6 rounded-full border-2 border-outline-variant bg-white flex items-center justify-center shrink-0 self-center";
          radioIndicator.innerHTML = "";
        }
      });

      if (type === 'yes') {
        yesCard.className = "relative flex items-start gap-3.5 p-3.5 rounded-2xl cursor-pointer border-2 border-emerald-500 bg-emerald-50/70 shadow-sm transition-all duration-150 active:scale-[0.98]";
        const ind = yesCard.querySelector('div:last-child');
        if (ind) {
          ind.className = "w-6 h-6 rounded-full border-2 border-emerald-600 bg-emerald-600 text-white flex items-center justify-center shrink-0 self-center";
          ind.innerHTML = `<span class="material-symbols-outlined text-[16px] font-bold" data-icon="check">check</span>`;
        }
      } else if (type === 'no') {
        noCard.className = "relative flex items-start gap-3.5 p-3.5 rounded-2xl cursor-pointer border-2 border-rose-500 bg-rose-50/80 shadow-sm transition-all duration-150 active:scale-[0.98]";
        const ind = noCard.querySelector('div:last-child');
        if (ind) {
          ind.className = "w-6 h-6 rounded-full border-2 border-rose-600 bg-rose-600 text-white flex items-center justify-center shrink-0 self-center";
          ind.innerHTML = `<span class="material-symbols-outlined text-[16px] font-bold" data-icon="close">close</span>`;
        }
      } else if (type === 'maybe') {
        maybeCard.className = "relative flex items-start gap-3.5 p-3.5 rounded-2xl cursor-pointer border-2 border-amber-500 bg-amber-50/80 shadow-sm transition-all duration-150 active:scale-[0.98]";
        const ind = maybeCard.querySelector('div:last-child');
        if (ind) {
          ind.className = "w-6 h-6 rounded-full border-2 border-amber-600 bg-amber-600 text-white flex items-center justify-center shrink-0 self-center";
          ind.innerHTML = `<span class="material-symbols-outlined text-[16px] font-bold" data-icon="hourglass_top">hourglass_top</span>`;
        }
      }
    }

    function appendNote(text) {
      const textarea = document.getElementById('coach-notes');
      if (textarea) {
        if (textarea.value.trim() === '') {
          textarea.value = text;
        } else if (!textarea.value.includes(text)) {
          textarea.value += ' · ' + text;
        }
        textarea.focus();
      }
    }

    function triggerSaveFeedback() {
      const btn = document.getElementById('save-btn');
      if (!btn) return;
      const originalHTML = btn.innerHTML;
      btn.classList.remove('bg-primary-container');
      btn.classList.add('bg-secondary');
      btn.innerHTML = `<span class="material-symbols-outlined text-[22px]" data-icon="done_all">done_all</span><span>¡Disponibilidad Confirmada!</span>`;
      setTimeout(() => {
        btn.classList.remove('bg-secondary');
        btn.classList.add('bg-primary-container');
        btn.innerHTML = originalHTML;
      }, 2000);
    }
  </script>
</body>
</html>
"""

body_sections = f"""
        <!-- SCREEN 0: V2 ONBOARDING - ACCESO INICIAL Y SELECCIÓN DE ROL -->
        <section id="v2_00_onboarding_welcome" class="app-screen-view w-full">
          {screens_html["v2_00_onboarding_welcome"]}
        </section>

        <!-- SCREEN 0a: V2 ONBOARDING ENTRENADOR - CREAR EQUIPO & CÓDIGO INDA16 -->
        <section id="v2_00_coach_create_team" class="app-screen-view w-full hidden">
          {screens_html["v2_00_coach_create_team"]}
        </section>

        <!-- SCREEN 0b: V2 ONBOARDING FAMILIA - UNIRSE AL EQUIPO & VINCULAR MENOR -->
        <section id="v2_00_parent_join_team" class="app-screen-view w-full hidden">
          {screens_html["v2_00_parent_join_team"]}
        </section>

        <!-- SCREEN 1: V2 INICIO - LA MESA DEL ENTRENADOR -->
        <section id="v2_01_coach_home" class="app-screen-view w-full hidden">
          {screens_html["v2_01_coach_home"]}
        </section>

        <!-- SCREEN 2: V2 AGENDA - EL TIEMPO DEL EQUIPO -->
        <section id="v2_02_coach_agenda" class="app-screen-view w-full hidden">
          {screens_html["v2_02_coach_agenda"]}
        </section>

        <!-- SCREEN 3: V2 EQUIPO - LAS PERSONAS (18 JUGADORES) -->
        <section id="v2_03_coach_roster" class="app-screen-view w-full hidden">
          {screens_html["v2_03_coach_roster"]}
        </section>

        <!-- SCREEN 4: V2 DETALLE DE JUGADOR (IBAI #9) -->
        <section id="v2_04_player_detail" class="app-screen-view w-full hidden">
          {screens_html["v2_04_player_detail"]}
        </section>

        <!-- SCREEN 5: V2 EVENT HUB NORMAL (DISPONIBILIDAD) -->
        <section id="v2_05_event_hub_normal" class="app-screen-view w-full hidden">
          {screens_html["v2_05_event_hub_normal"]}
        </section>

        <!-- SCREEN 6: V2 EVENT HUB ASISTENCIA / SUPLENTES (BAJA & SUSTITUCIÓN NEUTRAL) -->
        <section id="v2_06_event_hub_injury" class="app-screen-view w-full hidden">
          <!-- Resolved Banner (Shown after substitution confirmed) -->
          <div id="injury-resolved-banner" class="hidden p-4 mx-4 mt-4 bg-emerald-50 border-2 border-emerald-500 rounded-2xl shadow-sm text-emerald-900">
            <div class="flex items-center gap-2 font-bold text-emerald-800 text-sm">
              <span class="material-symbols-outlined text-[20px] text-emerald-600">verified</span>
              <span>¡Convocatoria 12/12 Completa y Confirmada!</span>
            </div>
            <p class="text-xs text-emerald-700 mt-1">
              <strong>Ane Mintegi (#16)</strong> ha sido incorporada como sustituta de Ibai. Se ha emitido el aviso al grupo de familias.
            </p>
          </div>
          {screens_html["v2_06_event_hub_injury"]}
        </section>

        <!-- SCREEN 7: V2 INICIO FAMILIAR (ELENA GÓMEZ / IBAI #9) -->
        <section id="v2_07_parent_home" class="app-screen-view w-full hidden">
          {screens_html["v2_07_parent_home"]}
        </section>

        <!-- SCREEN 8: V2 RESPONDER DISPONIBILIDAD EN 3s -->
        <section id="v2_08_parent_rsvp" class="app-screen-view w-full hidden">
          {screens_html["v2_08_parent_rsvp"]}
        </section>

        <!-- AUXILIARY SCREEN: CREAR EVENTO RÁPIDO -->
        <section id="screen_c_create_event" class="app-screen-view w-full hidden">
          {screens_html["screen_c_create_event"]}
        </section>

        <!-- AUXILIARY SCREEN: CREAR CONVOCATORIA -->
        <section id="screen_e_create_squad" class="app-screen-view w-full hidden">
          {screens_html["screen_e_create_squad"]}
        </section>

        <!-- AUXILIARY SCREEN: TABLÓN DE AVISOS OFICIALES -->
        <section id="screen_k_notices" class="app-screen-view w-full hidden">
          {screens_html["screen_k_notices"]}
        </section>
"""

final_html = header_html + body_sections + footer_html
open("/home/anarqorp/TaldeHemendik/index.html", "w", encoding="utf-8").write(final_html)
print(f"Successfully assembled cleaned V2 index.html! Size: {len(final_html)} chars")
