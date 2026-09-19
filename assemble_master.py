import re

# Read template and Stitch screens
screens_order = [
    ("screen_a_home_coach", "stitch_screens/screen_a_home_coach.html"),
    ("screen_b_calendar", "stitch_screens/screen_b_calendar.html"),
    ("screen_c_create_event", "stitch_screens/screen_c_create_event.html"),
    ("screen_d_event_detail_coach", "stitch_screens/screen_d_event_detail_coach.html"),
    ("screen_e_create_squad", "stitch_screens/screen_e_create_squad.html"),
    ("screen_f_squad_published_injury", "stitch_screens/screen_f_squad_published_injury.html"),
    ("screen_g_home_parent", "stitch_screens/screen_g_home_parent.html"),
    ("screen_h_rsvp_parent", "stitch_screens/screen_h_rsvp_parent.html"),
    ("screen_i_callup_parent", "stitch_screens/screen_i_callup_parent.html"),
    ("screen_j_roster", "stitch_screens/screen_j_roster.html"),
    ("screen_k_notices", "stitch_screens/screen_k_notices.html"),
]

# Extract body contents
screens_html = {}
for screen_id, file_path in screens_order:
    raw = open(file_path).read()
    m = re.search(r'<body[^>]*>(.*?)</body>', raw, re.DOTALL)
    if m:
        content = m.group(1)
        # Remove individual scripts
        content = re.sub(r'<script.*?</script>', '', content, flags=re.DOTALL)
        screens_html[screen_id] = content.strip()

# Inject interactive click handlers into specific screens:

# 1. Screen A:
# - CTA "Gestionar Disponibilidad y Convocatoria"
screens_html["screen_a_home_coach"] = screens_html["screen_a_home_coach"].replace(
    'Gestionar Disponibilidad y Convocatoria',
    'Gestionar Disponibilidad y Convocatoria'
)
# Make Torneo card clickable to Screen D
screens_html["screen_a_home_coach"] = re.sub(
    r'(<article class="[^"]*bg-surface-container-lowest[^"]*border-2 border-primary-container[^"]*")',
    r'\1 onclick="teamApp.goToScreen(\'screen_d_event_detail_coach\')" style="cursor:pointer;"',
    screens_html["screen_a_home_coach"],
    count=1
)
# Make the CTA button clickable
screens_html["screen_a_home_coach"] = re.sub(
    r'(<button class="[^"]*w-full[^"]*bg-primary-container[^"]*")',
    r'\1 onclick="teamApp.goToScreen(\'screen_d_event_detail_coach\')" style="cursor:pointer;"',
    screens_html["screen_a_home_coach"],
    count=1
)

# 2. Screen B:
# - FAB "+ Nuevo evento"
screens_html["screen_b_calendar"] = re.sub(
    r'(<button class="[^"]*fixed bottom-[^"]*rounded-full[^"]*bg-primary-container[^"]*")',
    r'\1 onclick="teamApp.goToScreen(\'screen_c_create_event\')" style="cursor:pointer;"',
    screens_html["screen_b_calendar"],
    count=1
)
# Card Torneo Indautxu in Calendar
screens_html["screen_b_calendar"] = screens_html["screen_b_calendar"].replace(
    'Ver detalle del evento',
    'Ver detalle del evento'
)
screens_html["screen_b_calendar"] = re.sub(
    r'(<div class="[^"]*bg-primary-fixed/20[^"]*border-2 border-primary[^"]*")',
    r'\1 onclick="teamApp.goToScreen(\'screen_d_event_detail_coach\')" style="cursor:pointer;"',
    screens_html["screen_b_calendar"],
    count=1
)

# 3. Screen C:
# Cancel button '✕'
screens_html["screen_c_create_event"] = re.sub(
    r'(<button aria-label="Cerrar"[^>]*>|<button class="[^"]*p-2 rounded-full text-on-surface-variant[^"]*">)',
    r'<button onclick="teamApp.goToScreen(\'screen_a_home_coach\')" class="p-2 rounded-full text-on-surface-variant cursor-pointer">',
    screens_html["screen_c_create_event"],
    count=1
)
# Primary submit button: "Crear evento y solicitar disponibilidad"
screens_html["screen_c_create_event"] = re.sub(
    r'(<button class="[^"]*w-full[^"]*bg-primary-container[^"]*")',
    r'\1 onclick="teamApp.showToast(\'✓ Torneo creado y disponibilidad solicitada a las 18 familias.\'); teamApp.goToScreen(\'screen_d_event_detail_coach\');" style="cursor:pointer;"',
    screens_html["screen_c_create_event"],
    count=1
)

# 4. Screen D:
# Back button
screens_html["screen_d_event_detail_coach"] = re.sub(
    r'(<button class="[^"]*rounded-full text-on-surface-variant[^"]*")',
    r'\1 onclick="teamApp.goToScreen(\'screen_a_home_coach\')" style="cursor:pointer;"',
    screens_html["screen_d_event_detail_coach"],
    count=1
)
# Reminder button: "Recordar a los 2 pendientes"
screens_html["screen_d_event_detail_coach"] = screens_html["screen_d_event_detail_coach"].replace(
    'Recordar a los 2 pendientes',
    'Recordar a los 2 pendientes'
)
screens_html["screen_d_event_detail_coach"] = re.sub(
    r'(<button class="[^"]*w-full[^"]*border border-tertiary-container[^"]*")',
    r'\1 onclick="teamApp.showToast(\'🔔 Recordatorio instantáneo enviado a Ane Gorostiaga y Peio Goikoetxea vía App.\');" style="cursor:pointer;"',
    screens_html["screen_d_event_detail_coach"],
    count=1
)
# CTA "Crear Convocatoria"
screens_html["screen_d_event_detail_coach"] = re.sub(
    r'(<button class="[^"]*w-full[^"]*bg-primary-container[^"]*")',
    r'\1 onclick="teamApp.goToScreen(\'screen_e_create_squad\')" style="cursor:pointer;"',
    screens_html["screen_d_event_detail_coach"],
    count=1
)

# 5. Screen E:
# Back button
screens_html["screen_e_create_squad"] = re.sub(
    r'(<button class="[^"]*p-2 rounded-full text-on-surface-variant[^"]*")',
    r'\1 onclick="teamApp.goToScreen(\'screen_d_event_detail_coach\')" style="cursor:pointer;"',
    screens_html["screen_e_create_squad"],
    count=1
)
# Counter span
screens_html["screen_e_create_squad"] = screens_html["screen_e_create_squad"].replace(
    'Jugadores Convocados (12/12)',
    '<span id="squad-selection-counter">12 / 12 Convocados</span>'
)
# Publish button
screens_html["screen_e_create_squad"] = re.sub(
    r'(<button class="[^"]*w-full[^"]*bg-primary-container[^"]*")',
    r'\1 id="squad-publish-btn" onclick="teamApp.triggerCallUpPublished()" style="cursor:pointer;"',
    screens_html["screen_e_create_squad"],
    count=1
)

# 6. Screen F:
# Back button
screens_html["screen_f_squad_published_injury"] = re.sub(
    r'(<button class="[^"]*rounded-full text-on-surface-variant[^"]*")',
    r'\1 onclick="teamApp.goToScreen(\'screen_a_home_coach\')" style="cursor:pointer;"',
    screens_html["screen_f_squad_published_injury"],
    count=1
)
# Alert box ID
screens_html["screen_f_squad_published_injury"] = re.sub(
    r'(<section class="bg-error-container/40[^"]*")',
    r'\1 id="injury-alert-box"',
    screens_html["screen_f_squad_published_injury"],
    count=1
)
# Replacement assistant section ID
screens_html["screen_f_squad_published_injury"] = re.sub(
    r'(<section class="bg-surface-container-lowest border border-outline-variant/60 rounded-xl p-4 shadow-sm")',
    r'\1 id="replacement-assistant-box"',
    screens_html["screen_f_squad_published_injury"],
    count=1
)
# Ibai baja row ID
screens_html["screen_f_squad_published_injury"] = re.sub(
    r'(<div class="mt-3 bg-red-50/70[^"]*")',
    r'\1 id="roster-ibai-row"',
    screens_html["screen_f_squad_published_injury"],
    count=1
)
# Ane Gorostiaga substitute row
ane_row_html = """
<div id="roster-ane-row" class="hidden mt-3 bg-emerald-50/80 border border-emerald-500/40 rounded-lg p-3 flex items-center justify-between">
  <div class="flex items-center gap-3">
    <div class="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center font-headline-sm text-headline-sm font-bold">
      16
    </div>
    <div>
      <div class="flex items-center gap-2">
        <span class="font-label-lg text-label-lg text-on-surface font-bold">Ane Gorostiaga</span>
        <span class="font-label-sm text-label-sm px-2 py-0.5 bg-emerald-600 text-white rounded font-bold">Sustituta oficial</span>
      </div>
      <p class="font-body-sm text-body-sm text-emerald-700 font-medium">Mediocentro / Delantera · Confirmada</p>
    </div>
  </div>
  <span class="material-symbols-outlined text-emerald-600 text-[22px]">check_circle</span>
</div>
"""
screens_html["screen_f_squad_published_injury"] = screens_html["screen_f_squad_published_injury"].replace(
    '<!-- Baja card item placed right at top for instant visual audit -->',
    '<!-- Baja card item placed right at top for instant visual audit -->' + ane_row_html
)
# Substitute Ane button: "+ Convocar como sustituta"
screens_html["screen_f_squad_published_injury"] = re.sub(
    r'(<button class="[^"]*h-\[48px\] bg-primary-container[^"]*")',
    r'\1 onclick="teamApp.triggerSubstitution()" style="cursor:pointer;"',
    screens_html["screen_f_squad_published_injury"],
    count=1
)
# Bottom button: "Completar con Ane Gorostiaga (#16)"
screens_html["screen_f_squad_published_injury"] = re.sub(
    r'(<button class="[^"]*w-full[^"]*bg-primary-container[^"]*")',
    r'\1 onclick="teamApp.triggerSubstitution()" style="cursor:pointer;"',
    screens_html["screen_f_squad_published_injury"],
    count=1
)

# 7. Screen G:
# "Responder Disponibilidad"
screens_html["screen_g_home_parent"] = re.sub(
    r'(<button class="[^"]*w-full[^"]*bg-primary-container[^"]*")',
    r'\1 onclick="teamApp.goToScreen(\'screen_h_rsvp_parent\')" style="cursor:pointer;"',
    screens_html["screen_g_home_parent"],
    count=1
)

# 8. Screen H:
# Close button
screens_html["screen_h_rsvp_parent"] = re.sub(
    r'(<button class="[^"]*p-2 rounded-full text-on-surface-variant[^"]*")',
    r'\1 onclick="teamApp.goToScreen(\'screen_g_home_parent\')" style="cursor:pointer;"',
    screens_html["screen_h_rsvp_parent"],
    count=1
)
# Option Yes
screens_html["screen_h_rsvp_parent"] = re.sub(
    r'(<div class="[^"]*bg-secondary-container/20[^"]*border-2 border-secondary[^"]*")',
    r'\1 onclick="teamApp.triggerParentRsvp(\'SI\')" style="cursor:pointer;"',
    screens_html["screen_h_rsvp_parent"],
    count=1
)
# Option No
screens_html["screen_h_rsvp_parent"] = re.sub(
    r'(<div class="[^"]*border-2 border-outline-variant/60[^"]*hover:border-error[^"]*")',
    r'\1 onclick="teamApp.triggerParentRsvp(\'NO\')" style="cursor:pointer;"',
    screens_html["screen_h_rsvp_parent"],
    count=1
)
# Option Maybe
screens_html["screen_h_rsvp_parent"] = re.sub(
    r'(<div class="[^"]*border-2 border-outline-variant/60[^"]*hover:border-tertiary[^"]*")',
    r'\1 onclick="teamApp.triggerParentRsvp(\'DUDA\')" style="cursor:pointer;"',
    screens_html["screen_h_rsvp_parent"],
    count=1
)
# Bottom Confirm button
screens_html["screen_h_rsvp_parent"] = re.sub(
    r'(<button class="[^"]*w-full[^"]*bg-primary-container[^"]*")',
    r'\1 onclick="teamApp.triggerParentRsvp(\'SI\')" style="cursor:pointer;"',
    screens_html["screen_h_rsvp_parent"],
    count=1
)

# 9. Screen I:
# Back button
screens_html["screen_i_callup_parent"] = re.sub(
    r'(<button class="[^"]*p-2 rounded-full text-on-surface-variant[^"]*")',
    r'\1 onclick="teamApp.goToScreen(\'screen_g_home_parent\')" style="cursor:pointer;"',
    screens_html["screen_i_callup_parent"],
    count=1
)
# Confirm CTA
screens_html["screen_i_callup_parent"] = re.sub(
    r'(<button class="[^"]*w-full[^"]*bg-secondary[^"]*")',
    r'\1 onclick="teamApp.showToast(\'✓ Asistencia de Ibai confirmada en tu calendario.\');" style="cursor:pointer;"',
    screens_html["screen_i_callup_parent"],
    count=1
)
# Late injury button: "⚠️ Ya no puede asistir (Informar de baja)"
screens_html["screen_i_callup_parent"] = re.sub(
    r'(<button class="[^"]*w-full[^"]*border-2 border-error[^"]*")',
    r'\1 onclick="confirmLateInjuryDialog()" style="cursor:pointer;"',
    screens_html["screen_i_callup_parent"],
    count=1
)

# 10. Screen J:
# Click on Ibai row or player rows to open sheet
screens_html["screen_j_roster"] = re.sub(
    r'(<div class="[^"]*border-2 border-error[^"]*bg-surface-container-lowest[^"]*")',
    r'\1 onclick="teamApp.openPlayerModal(9)" style="cursor:pointer;"',
    screens_html["screen_j_roster"],
    count=1
)
screens_html["screen_j_roster"] = re.sub(
    r'(<div class="[^"]*bg-surface-container-lowest border border-outline-variant/60 rounded-xl p-3 flex items-center justify-between[^"]*")',
    r'\1 onclick="teamApp.openPlayerModal(4)" style="cursor:pointer;"',
    screens_html["screen_j_roster"]
)

# 11. Screen K:
# Notice 1 link: "Ver convocatoria actualizada →"
screens_html["screen_k_notices"] = screens_html["screen_k_notices"].replace(
    'Ver convocatoria actualizada →',
    '<span onclick="teamApp.goToScreen(\'screen_f_squad_published_injury\')" class="cursor-pointer font-bold text-primary hover:underline">Ver convocatoria actualizada →</span>'
)

# Fix bottom navigation links across all screens that have nav:
def fix_nav_links(html):
    # Inicio
    html = re.sub(r'(<a[^>]*href="#"[^>]*>\s*<span[^>]*>sports_soccer</span>\s*<span[^>]*>Inicio</span>\s*</a>|<button[^>]*>\s*<span[^>]*>sports_soccer</span>\s*<span[^>]*>Inicio</span>\s*</button>)',
                  r'<button type="button" onclick="teamApp.goToScreen(teamApp.currentRole === \'coach\' ? \'screen_a_home_coach\' : \'screen_g_home_parent\')" class="flex flex-col items-center justify-center gap-1 text-primary cursor-pointer"><span class="material-symbols-outlined text-[24px]">sports_soccer</span><span class="font-label-sm text-[11px] font-bold">Inicio</span></button>', html)
    # Calendario
    html = re.sub(r'(<a[^>]*href="#"[^>]*>\s*<span[^>]*>(?:calendar_today|calendar_month|event)</span>\s*<span[^>]*>Calendario</span>\s*</a>|<button[^>]*>\s*<span[^>]*>(?:calendar_today|calendar_month|event)</span>\s*<span[^>]*>Calendario</span>\s*</button>)',
                  r'<button type="button" onclick="teamApp.goToScreen(\'screen_b_calendar\')" class="flex flex-col items-center justify-center gap-1 text-on-surface-variant hover:text-primary cursor-pointer"><span class="material-symbols-outlined text-[24px]">calendar_month</span><span class="font-label-sm text-[11px] font-medium">Calendario</span></button>', html)
    # Equipo / Plantilla / Mis Hijos
    html = re.sub(r'(<a[^>]*href="#"[^>]*>\s*<span[^>]*>groups</span>\s*<span[^>]*>(?:Equipo|Plantilla|Mis Hijos)</span>\s*</a>|<button[^>]*>\s*<span[^>]*>groups</span>\s*<span[^>]*>(?:Equipo|Plantilla|Mis Hijos)</span>\s*</button>)',
                  r'<button type="button" onclick="teamApp.goToScreen(\'screen_j_roster\')" class="flex flex-col items-center justify-center gap-1 text-on-surface-variant hover:text-primary cursor-pointer"><span class="material-symbols-outlined text-[24px]">groups</span><span class="font-label-sm text-[11px] font-medium">Equipo</span></button>', html)
    # Avisos
    html = re.sub(r'(<a[^>]*href="#"[^>]*>\s*<span[^>]*>notifications</span>\s*<span[^>]*>Avisos</span>\s*</a>|<button[^>]*>\s*<span[^>]*>notifications</span>\s*<span[^>]*>Avisos</span>\s*</button>)',
                  r'<button type="button" onclick="teamApp.goToScreen(\'screen_k_notices\')" class="flex flex-col items-center justify-center gap-1 text-on-surface-variant hover:text-primary cursor-pointer"><span class="material-symbols-outlined text-[24px]">notifications</span><span class="font-label-sm text-[11px] font-medium">Avisos</span></button>', html)
    return html

for sid in screens_html:
    screens_html[sid] = fix_nav_links(screens_html[sid])

# Build master HTML
master_template = """<!DOCTYPE html>
<html lang="es" class="light">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"/>
  <title>Talde Hemendik! - Demostrador Interactivo Mobile-First</title>
  
  <!-- Fonts -->
  <link rel="preconnect" href="https://fonts.googleapis.com"/>
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
  <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet"/>
  
  <!-- Tailwind CSS CDN -->
  <script src="https://cdn.tailwindcss.com?plugins=forms,container-queries"></script>
  <script>
    tailwind.config = {
      darkMode: "class",
      theme: {
        extend: {
          colors: {
            "surface-dim": "#d2d9f4",
            "primary-fixed-dim": "#b7c4ff",
            "primary-fixed": "#dce1ff",
            "on-primary": "#ffffff",
            "on-tertiary-fixed": "#410002",
            "primary-container": "#1d4ed8",
            "primary": "#0037b0",
            "secondary": "#006c4a",
            "outline": "#747686",
            "secondary-container": "#82f5c1",
            "inverse-on-surface": "#eef0ff",
            "tertiary-container": "#bb0112",
            "on-primary-fixed-variant": "#0039b5",
            "error-container": "#ffdad6",
            "surface-container-lowest": "#ffffff",
            "on-tertiary-container": "#ffc7c1",
            "surface": "#faf8ff",
            "surface-tint": "#2151da",
            "on-primary-container": "#cad3ff",
            "surface-container-low": "#f2f3ff",
            "on-tertiary-fixed-variant": "#93000b",
            "surface-bright": "#faf8ff",
            "on-secondary": "#ffffff",
            "tertiary-fixed-dim": "#ffb4ab",
            "error": "#ba1a1a",
            "on-background": "#131b2e",
            "secondary-fixed-dim": "#68dba9",
            "surface-container": "#eaedff",
            "on-tertiary": "#ffffff",
            "on-secondary-fixed": "#002114",
            "on-error-container": "#93000a",
            "on-surface-variant": "#434655",
            "inverse-surface": "#283044",
            "tertiary": "#8f000b",
            "on-error": "#ffffff",
            "on-primary-fixed": "#001551",
            "secondary-fixed": "#85f8c4",
            "surface-container-highest": "#dae2fd",
            "outline-variant": "#c4c5d7",
            "surface-container-high": "#e2e7ff",
            "inverse-primary": "#b7c4ff",
            "on-surface": "#131b2e",
            "background": "#faf8ff",
            "on-secondary-fixed-variant": "#005137",
            "tertiary-fixed": "#ffdad6",
            "surface-variant": "#dae2fd",
            "on-secondary-container": "#00714e"
          },
          fontFamily: {
            sans: ['"Plus Jakarta Sans"', 'sans-serif'],
            'body-md': ['"Plus Jakarta Sans"', 'sans-serif'],
            'headline-md': ['"Plus Jakarta Sans"', 'sans-serif'],
            'headline-sm': ['"Plus Jakarta Sans"', 'sans-serif'],
            'headline-lg': ['"Plus Jakarta Sans"', 'sans-serif'],
            'headline-xl': ['"Plus Jakarta Sans"', 'sans-serif'],
            'label-sm': ['"Plus Jakarta Sans"', 'sans-serif'],
            'label-md': ['"Plus Jakarta Sans"', 'sans-serif'],
            'label-lg': ['"Plus Jakarta Sans"', 'sans-serif'],
          }
        }
      }
    }
  </script>
  
  <style>
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
    }
    .material-symbols-outlined {
      font-variation-settings: 'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 24;
      vertical-align: middle;
    }
    .fill-icon {
      font-variation-settings: 'FILL' 1;
    }
    /* Mobile Device Mockup Frame */
    @media (min-width: 640px) {
      .mockup-wrapper {
        box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.4), 0 0 0 12px #0f172a, 0 0 0 14px #334155;
      }
    }
    /* Custom scrollbar */
    ::-webkit-scrollbar {
      width: 4px;
      height: 4px;
    }
    ::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 4px;
    }
  </style>
</head>
<body class="bg-slate-950 text-slate-100 min-h-screen flex flex-col items-center justify-start overflow-x-hidden selection:bg-blue-600 selection:text-white">

  <!-- ======================================================== -->
  <!-- BARRA DE CONTROL EXTERNA DE LA DEMO (Separada del producto) -->
  <!-- ======================================================== -->
  <aside class="w-full max-w-6xl mx-auto px-2 sm:px-4 py-2 sm:py-3 bg-slate-900 border-b border-slate-800 flex flex-col md:flex-row items-center justify-between gap-2 sm:gap-3 shrink-0 z-50 sticky top-0 shadow-lg">
    
    <!-- Branding & Info + Mobile Info Toggle -->
    <div class="w-full md:w-auto flex items-center justify-between gap-2.5">
      <div class="flex items-center gap-2">
        <div class="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-black text-xs sm:text-sm shadow-sm">
          TH!
        </div>
        <div>
          <div class="flex items-center gap-1.5">
            <span class="font-extrabold text-xs sm:text-sm tracking-tight text-white">Talde Hemendik!</span>
            <span class="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-blue-900/60 text-blue-300 border border-blue-700/50">Demo MVP</span>
          </div>
          <p class="text-[10px] sm:text-[11px] text-slate-400">C.D. Indautxu · Infantil A (18 jug.)</p>
        </div>
      </div>

      <!-- Mobile info card toggle button -->
      <button onclick="toggleInfoCard()" class="md:hidden px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] flex items-center gap-1 cursor-pointer">
        <span class="material-symbols-outlined text-[14px]">info</span>
        <span id="info-btn-label">Paso 1</span>
        <span id="info-btn-icon" class="material-symbols-outlined text-[14px]">expand_more</span>
      </button>
    </div>

    <!-- Switcher de Roles (Entrenador vs Tutor) -->
    <div class="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 shrink-0">
      <button id="demo-role-coach" onclick="teamApp.setRole('coach')" class="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-bold bg-blue-600 text-white shadow-sm flex items-center gap-1 sm:gap-1.5 cursor-pointer">
        <span class="material-symbols-outlined text-[15px] sm:text-[16px]">sports</span>
        <span>Míster (Mikel)</span>
      </button>
      <button id="demo-role-parent" onclick="teamApp.setRole('parent')" class="px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-medium text-slate-300 hover:bg-slate-800 flex items-center gap-1 sm:gap-1.5 cursor-pointer">
        <span class="material-symbols-outlined text-[15px] sm:text-[16px]">family_restroom</span>
        <span>Familia (Amaia)</span>
      </button>
    </div>

    <!-- Navegación de Paso Guiado (1 a 14) -->
    <div class="w-full md:w-auto flex items-center justify-center gap-1.5 sm:gap-2 overflow-x-hidden">
      <div class="flex items-center bg-slate-950 px-1.5 sm:px-2 py-1 rounded-xl border border-slate-800 gap-1 shrink-0">
        <button onclick="teamApp.prevStep()" class="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 cursor-pointer" title="Paso anterior">
          <span class="material-symbols-outlined text-[16px] sm:text-[18px]">chevron_left</span>
        </button>
        <span id="demo-step-badge" class="font-mono text-[11px] sm:text-xs font-bold text-blue-400 px-1 whitespace-nowrap">Paso 1/14</span>
        <button onclick="teamApp.nextStep()" class="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 cursor-pointer" title="Paso siguiente">
          <span class="material-symbols-outlined text-[16px] sm:text-[18px]">chevron_right</span>
        </button>
      </div>

      <!-- Selector Directo de Pantalla -->
      <select id="demo-screen-select" onchange="teamApp.goToScreen(this.value)" class="flex-1 md:flex-none max-w-[155px] sm:max-w-none bg-slate-950 text-slate-200 border border-slate-800 rounded-xl px-2 py-1 text-[11px] sm:text-xs focus:ring-1 focus:ring-blue-500 cursor-pointer text-ellipsis overflow-hidden">
        <option value="screen_a_home_coach">A · Home Entrenador</option>
        <option value="screen_b_calendar">B · Calendario Equipo</option>
        <option value="screen_c_create_event">C · Crear Evento</option>
        <option value="screen_d_event_detail_coach">D · Detalle Torneo (Entrenador)</option>
        <option value="screen_e_create_squad">E · Crear Convocatoria</option>
        <option value="screen_f_squad_published_injury">F · Baja Ibai & Sustitución</option>
        <option value="screen_g_home_parent">G · Home Tutor (Amaia)</option>
        <option value="screen_h_rsvp_parent">H · Responder Disponibilidad</option>
        <option value="screen_i_callup_parent">I · Convocatoria (Tutor)</option>
        <option value="screen_j_roster">J · Plantilla (18 jug.)</option>
        <option value="screen_k_notices">K · Avisos Operativos</option>
      </select>

      <button onclick="teamApp.resetDemo()" class="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded-lg cursor-pointer shrink-0" title="Reiniciar toda la demo">
        <span class="material-symbols-outlined text-[16px] sm:text-[18px]">restart_alt</span>
      </button>
    </div>
  </aside>

  <!-- Barra informativa de la etapa guiada -->
  <div id="demo-step-card" class="w-full max-w-xl mx-auto px-2 sm:px-4 mt-1 sm:mt-2 transition-all duration-200">
    <div class="bg-slate-900/90 border border-slate-800 rounded-xl p-2.5 sm:p-3 shadow-md">
      <div class="flex items-center justify-between gap-2 mb-1">
        <h2 id="demo-step-title" class="text-xs font-bold text-blue-400">1. Entrenador entra en Inicio</h2>
        <span class="text-[10px] text-slate-400 font-mono">14 pasos verificables</span>
      </div>
      <p id="demo-step-desc" class="text-[11px] sm:text-xs text-slate-300 leading-snug">
        Mikel (entrenador) consulta el resumen operativo. El bloque 'REQUIERE TU ATENCIÓN' destaca el Torneo Indautxu con las respuestas recibidas.
      </p>
      <div class="mt-1.5 pt-1.5 border-t border-slate-800/80 flex items-center justify-between text-[10px] sm:text-[11px]">
        <div class="text-amber-400 font-medium flex items-center gap-1">
          <span class="material-symbols-outlined text-[13px] sm:text-[14px]">touch_app</span>
          <span id="demo-step-action">Pulsa en 'Gestionar Disponibilidad y Convocatoria' o en la tarjeta del Torneo Indautxu.</span>
        </div>
      </div>
      <!-- Barra de progreso lineal -->
      <div class="w-full bg-slate-800 h-1 rounded-full mt-1.5 overflow-hidden">
        <div id="demo-step-progress" class="bg-blue-500 h-full rounded-full transition-all duration-300" style="width: 7.14%"></div>
      </div>
    </div>
  </div>

  <!-- ======================================================== -->
  <!-- MOBILE DEVICE VIEWPORT CONTAINER -->
  <!-- ======================================================== -->
  <div class="w-full flex-1 flex items-center justify-center p-0 sm:p-4 my-auto overflow-hidden">
    <div class="mockup-wrapper w-full sm:max-w-[390px] h-[calc(100dvh-125px)] sm:h-[844px] bg-surface rounded-none sm:rounded-[40px] border-0 sm:border-[6px] border-slate-900 flex flex-col relative overflow-hidden text-on-surface shadow-none sm:shadow-2xl">
      
      <!-- Top Smartphone Notch / Dynamic Island (Only on desktop preview) -->
      <div class="hidden sm:flex w-full h-8 bg-surface-container-lowest items-center justify-between px-6 shrink-0 z-50 select-none border-b border-outline-variant/30">
        <span class="text-[12px] font-bold text-on-surface tracking-tight">10:30</span>
        <div class="w-20 h-4 bg-slate-950 rounded-full mx-auto"></div>
        <div class="flex items-center gap-1.5 text-on-surface text-[12px]">
          <span class="material-symbols-outlined text-[14px]">signal_cellular_4_bar</span>
          <span class="material-symbols-outlined text-[14px]">wifi</span>
          <span class="material-symbols-outlined text-[16px] text-secondary">battery_full</span>
        </div>
      </div>

      <!-- Main Scrollable App Viewport for Screens -->
      <div id="phone-viewport" class="w-full flex-1 overflow-y-auto overflow-x-hidden relative bg-surface">
        
        <!-- SCREEN A: HOME ENTRENADOR -->
        <section id="screen_a_home_coach" class="app-screen-view w-full">
          """ + screens_html["screen_a_home_coach"] + """
        </section>

        <!-- SCREEN B: CALENDARIO DEL EQUIPO -->
        <section id="screen_b_calendar" class="app-screen-view w-full hidden">
          """ + screens_html["screen_b_calendar"] + """
        </section>

        <!-- SCREEN C: CREAR EVENTO -->
        <section id="screen_c_create_event" class="app-screen-view w-full hidden">
          """ + screens_html["screen_c_create_event"] + """
        </section>

        <!-- SCREEN D: DETALLE DEL EVENTO (ENTRENADOR) -->
        <section id="screen_d_event_detail_coach" class="app-screen-view w-full hidden">
          """ + screens_html["screen_d_event_detail_coach"] + """
        </section>

        <!-- SCREEN E: CREAR CONVOCATORIA -->
        <section id="screen_e_create_squad" class="app-screen-view w-full hidden">
          """ + screens_html["screen_e_create_squad"] + """
        </section>

        <!-- SCREEN F: CONVOCATORIA PUBLICADA & BAJAS / SUSTITUCIÓN -->
        <section id="screen_f_squad_published_injury" class="app-screen-view w-full hidden">
          <!-- Resolved Banner (Shown after substitution) -->
          <div id="substitution-resolved-box" class="hidden p-4 mx-4 mt-4 bg-emerald-50 border-2 border-emerald-500 rounded-2xl shadow-sm text-emerald-900">
            <div class="flex items-center gap-2 font-bold text-emerald-800 text-sm">
              <span class="material-symbols-outlined text-[20px] text-emerald-600">verified</span>
              <span>¡Convocatoria Completa (12 / 12)!</span>
            </div>
            <p class="text-xs text-emerald-700 mt-1">
              <strong>Ane Gorostiaga (#16)</strong> ha sido incorporada oficialmente como sustituta de Ibai. Se ha emitido aviso al grupo de familias.
            </p>
          </div>
          """ + screens_html["screen_f_squad_published_injury"] + """
        </section>

        <!-- SCREEN G: HOME DEL TUTOR (AMAIA / IBAI #9) -->
        <section id="screen_g_home_parent" class="app-screen-view w-full hidden">
          """ + screens_html["screen_g_home_parent"] + """
        </section>

        <!-- SCREEN H: RESPONDER DISPONIBILIDAD (TUTOR) -->
        <section id="screen_h_rsvp_parent" class="app-screen-view w-full hidden">
          """ + screens_html["screen_h_rsvp_parent"] + """
        </section>

        <!-- SCREEN I: CONVOCATORIA TUTOR (IBAI CONVOCADO) -->
        <section id="screen_i_callup_parent" class="app-screen-view w-full hidden">
          """ + screens_html["screen_i_callup_parent"] + """
        </section>

        <!-- SCREEN J: EQUIPO / PLANTILLA -->
        <section id="screen_j_roster" class="app-screen-view w-full hidden">
          """ + screens_html["screen_j_roster"] + """
        </section>

        <!-- SCREEN K: AVISOS OPERATIVOS -->
        <section id="screen_k_notices" class="app-screen-view w-full hidden">
          """ + screens_html["screen_k_notices"] + """
        </section>

      </div>

      <!-- Bottom Smartphone Home Indicator Bar -->
      <div class="w-full h-5 bg-surface-container-lowest flex items-center justify-center shrink-0 z-50 border-t border-outline-variant/30">
        <div class="w-32 h-1 bg-slate-400 rounded-full"></div>
      </div>

    </div>
  </div>

  <!-- ======================================================== -->
  <!-- MODAL: CONFIRMACIÓN DE BAJA MÉDICA DE IBAI (#9) -->
  <!-- ======================================================== -->
  <div id="injury-confirm-dialog" class="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 hidden">
    <div class="bg-white text-slate-900 rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200 animate-in fade-in zoom-in duration-200">
      <div class="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-3">
        <span class="material-symbols-outlined text-[28px]">warning</span>
      </div>
      <h3 class="font-bold text-lg text-center text-slate-900 leading-tight">¿Informar de baja justificada?</h3>
      <p class="text-xs text-slate-600 text-center mt-2 leading-relaxed">
        Estás indicando que <strong>Ibai Aranguren (#9)</strong> causará baja en el <strong>Torneo Indautxu</strong>.
      </p>
      
      <div class="mt-3.5 bg-slate-50 p-3 rounded-xl border border-slate-200 text-xs space-y-1.5">
        <label class="font-bold text-slate-700 block">Motivo justificado de la baja:</label>
        <div class="flex items-center gap-2 text-slate-800">
          <input type="radio" checked id="fever-radio" name="reason" class="text-blue-600 focus:ring-blue-500"/>
          <label for="fever-radio">Fiebre sobrevenida (38.5°)</label>
        </div>
        <div class="flex items-center gap-2 text-slate-800">
          <input type="radio" id="injury-radio" name="reason" class="text-blue-600 focus:ring-blue-500"/>
          <label for="injury-radio">Lesión muscular o traumatismo</label>
        </div>
        <div class="flex items-center gap-2 text-slate-800">
          <input type="radio" id="force-radio" name="reason" class="text-blue-600 focus:ring-blue-500"/>
          <label for="force-radio">Causa mayor justificada</label>
        </div>
      </div>

      <div class="mt-4 flex flex-col gap-2">
        <button onclick="confirmLateInjuryAction()" class="w-full h-11 bg-red-600 hover:bg-red-700 text-white font-bold text-sm rounded-xl cursor-pointer shadow-sm">
          Sí, comunicar baja al entrenador
        </button>
        <button onclick="closeLateInjuryDialog()" class="w-full h-10 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-sm rounded-xl cursor-pointer">
          Cancelar y volver
        </button>
      </div>
    </div>
  </div>

  <!-- ======================================================== -->
  <!-- MODAL: FICHA PROTEGIDA DE JUGADOR (RGPD / MINIMIZACIÓN) -->
  <!-- ======================================================== -->
  <div id="player-detail-sheet" class="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 hidden">
    <div class="bg-white text-slate-900 rounded-t-3xl sm:rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-slate-200">
      <div class="flex items-center justify-between pb-3 border-b border-slate-100">
        <div class="flex items-center gap-2.5">
          <span id="sheet-player-num" class="w-9 h-9 rounded-full bg-blue-100 text-blue-700 font-extrabold flex items-center justify-center text-sm">#9</span>
          <div>
            <h4 id="sheet-player-name" class="font-bold text-base text-slate-900 leading-tight">Ibai Aranguren</h4>
            <p id="sheet-player-role" class="text-xs text-slate-500">Delantero · C.D. Indautxu Infantil A</p>
          </div>
        </div>
        <button onclick="teamApp.closePlayerModal()" class="p-1.5 text-slate-400 hover:text-slate-700 rounded-full cursor-pointer">
          <span class="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      <div class="mt-3 space-y-2.5 text-xs">
        <div class="p-3 bg-blue-50/60 rounded-xl border border-blue-100">
          <span class="font-bold text-blue-800 block mb-0.5">Estado en Torneo Indautxu:</span>
          <span id="sheet-player-status" class="text-blue-900 font-medium">Baja sobrevenida (Fiebre)</span>
        </div>

        <div class="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <span class="font-bold text-slate-700 block mb-1">Contacto de emergencia tutores (Protegido):</span>
          <div class="flex items-center justify-between text-slate-800">
            <div>
              <p id="sheet-tutor-name" class="font-semibold text-slate-900">Amaia Aranguren (Madre)</p>
              <p id="sheet-tutor-phone" class="font-mono text-slate-600">654 32 10 98</p>
            </div>
            <a href="tel:654321098" class="px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg font-bold flex items-center gap-1 text-[11px]">
              <span class="material-symbols-outlined text-[14px]">call</span> Llamar
            </a>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-2 text-[11px]">
          <div class="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
            <span class="text-slate-500 block">Equipación:</span>
            <span class="font-bold text-slate-800">Talla M (2ª equipación)</span>
          </div>
          <div class="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
            <span class="text-slate-500 block">Ficha Médica:</span>
            <span class="font-bold text-emerald-700">✓ En vigor (24/25)</span>
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
  <div id="demo-toast" class="fixed bottom-6 bg-slate-900 text-white border border-blue-500/50 px-4 py-2.5 rounded-xl shadow-2xl text-xs font-semibold z-50 transition-all duration-300 transform opacity-0 pointer-events-none translate-y-2 max-w-md text-center">
    Notificación
  </div>

  <!-- JavaScript Logic -->
  <script src="app.js"></script>
  <script>
    function confirmLateInjuryDialog() {
      document.getElementById('injury-confirm-dialog').classList.remove('hidden');
    }
    function closeLateInjuryDialog() {
      document.getElementById('injury-confirm-dialog').classList.add('hidden');
    }
    function confirmLateInjuryAction() {
      closeLateInjuryDialog();
      teamApp.triggerLateInjury();
    }
  </script>
</body>
</html>
"""

open("/home/anarqorp/TaldeHemendik/index.html", "w").write(master_template)
print("Successfully generated master index.html!")
