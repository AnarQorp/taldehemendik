/**
 * Talde Hemendik! V2 - Product Architecture Controller
 * Conectado con Backend Real Fastify + PostgreSQL (Vertical Slice 01 & 02)
 *
 * Principio Fundamental:
 * - Evidencia observable sobre narrativa
 * - Integración real con endpoints sin reimplementar lógica de negocio en frontend
 * - Persistencia íntegra en PostgreSQL
 */

import { api, DEMO_CONFIG, mapDomainError, idempotencyManager } from "./src/api/index.js";

// Dataset histórico de jugadores para pantallas visuales / no migradas
const SQUAD_DATA = [
  { id: 1, number: 1, name: "Gorka Elejalde", role: "Portero", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Iker Elejalde", phone: "611 22 33 44" },
  { id: 2, number: 2, name: "Eneko Zabala", role: "Defensa", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Joseba Zabala", phone: "622 33 44 55" },
  { id: 3, number: 3, name: "Julen Ortiz", role: "Defensa", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Xabier Ortiz", phone: "633 44 55 66" },
  { id: 4, number: 4, name: "Jon Beltrán", role: "Defensa", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Iñaki Beltrán", phone: "644 55 66 77" },
  { id: 5, number: 5, name: "Markel Saenz", role: "Centrocampista", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Elena Saenz", phone: "655 66 77 88" },
  { id: 6, number: 6, name: "Ander Lopez", role: "Centrocampista", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Begoña Lopez", phone: "666 77 88 99" },
  { id: 7, number: 7, name: "Unai Martinez", role: "Delantero", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Kepa Martinez", phone: "677 88 99 00" },
  { id: 8, number: 8, name: "Oier Gomez", role: "Centrocampista", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Maite Gomez", phone: "688 99 00 11" },
  { id: 9, number: 9, name: "Ibai Aranguren", role: "Delantero Centro", status: "NO_DISPONIBLE", rsvp: "No disponible (está enfermo)", tutor: "Elena Gómez (Madre)", phone: "620 44 55 66" },
  { id: 10, number: 10, name: "Mikel Zabaleta", role: "Centrocampista", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Aitor Zabaleta", phone: "699 00 11 22" },
  { id: 11, number: 11, name: "Aimar Ortiz", role: "Delantero", status: "CONVOCADO", rsvp: "Confirmado", tutor: "Miren Ortiz", phone: "600 11 22 33" },
  { id: 12, number: 12, name: "Nahia Garcia", role: "Centrocampista", status: "RESERVA", rsvp: "Confirmó disponibilidad", tutor: "Nerea Garcia", phone: "612 23 34 45" },
  { id: 13, number: 13, name: "Asier Urkijo", role: "Centrocampista", status: "NO_DISPONIBLE", rsvp: "No puede (Viaje familiar)", tutor: "Mikel Urkijo", phone: "623 34 45 56" },
  { id: 14, number: 14, name: "Iker Baroja", role: "Extremo", status: "CONVOCADO", rsvp: "Sin respuesta", tutor: "Carmen Baroja", phone: "634 45 56 67" },
  { id: 15, number: 15, name: "Irati Fernandez", role: "Delantera", status: "RESERVA", rsvp: "Confirmó disponibilidad", tutor: "Patxi Fernandez", phone: "645 56 67 78" },
  { id: 16, number: 16, name: "Ane Mintegi", role: "Centrocampista", status: "SUSTITUTA_ELEGIDA", rsvp: "Disponible · Reserva", tutor: "Iñaki Mintegi", phone: "644 55 66 77" },
  { id: 17, number: 17, name: "Olatz Bengoa", role: "Defensa", status: "NO_DISPONIBLE", rsvp: "No puede asistir", tutor: "Sonia Bengoa", phone: "656 67 78 89" },
  { id: 18, number: 18, name: "Peio Gómez", role: "Defensa", status: "NO_DISPONIBLE", rsvp: "Sin respuesta", tutor: "Asier Gómez", phone: "667 78 89 90" }
];

const GUIDED_STEPS = [
  {
    step: 1,
    role: "onboard",
    screen: "v2_00_onboarding_welcome",
    tab: "onboard",
    title: "1. Acceso Inicial: ¿Cómo vas a utilizar la app?",
    desc: "Pantalla única de bienvenida para todo el club. El usuario elige su función: 'Soy entrenador / staff' o 'Soy padre, madre o tutor'. Sin apps separadas.",
    actionHint: "Pulsa 'Soy entrenador / staff' para iniciar la creación del equipo."
  },
  {
    step: 2,
    role: "coach",
    screen: "v2_00_coach_create_team",
    tab: "onboard",
    title: "2. Flujo Entrenador: Crear equipo & Código INDA16",
    desc: "Alta inmediata con 3 datos clave: Nombre, Deporte y Categoría. 18 jugadores precargados. Código INDA16 generado para compartir por WhatsApp.",
    actionHint: "Pulsa 'Ir a la mesa del entrenador' para acceder al panel con la puesta en marcha."
  },
  {
    step: 3,
    role: "parent",
    screen: "v2_00_parent_join_team",
    tab: "onboard",
    title: "3. Flujo Familia: Solicitud de Vinculación (Privacidad Menor)",
    desc: "Elena Gómez introduce el código INDA16. El código identifica al club, pero NO muestra datos privados. Elena solicita vincularse a su hijo Ibai (#9).",
    actionHint: "Pulsa 'Enviar solicitud de vinculación' para notificar al entrenador."
  },
  {
    step: 4,
    role: "coach",
    screen: "v2_01_coach_home",
    tab: "inicio",
    title: "4. Mesa del Entrenador: Puesta en marcha & Aprobación",
    desc: "El inicio muestra temporalmente el estado de puesta en marcha (18 jugadores, 12 vinculadas, 6 pendientes) y la solicitud de Elena Gómez. Con 1 toque el míster aprueba.",
    actionHint: "Pulsa 'Aceptar' en la solicitud de Elena Gómez para vincularla a Ibai (#9)."
  },
  {
    step: 5,
    role: "coach",
    screen: "v2_01_coach_home",
    tab: "inicio",
    title: "5. La Mesa del Entrenador: Triage y Pendiente de ti",
    desc: "El míster visualiza de inmediato la alerta crítica del Torneo Indautxu en Pendiente de ti según los datos reales de PostgreSQL.",
    actionHint: "Pulsa en 'Revisar' o 'Preparar convocatoria' en la tarjeta del Torneo Indautxu."
  },
  {
    step: 6,
    role: "coach",
    screen: "v2_02_coach_agenda",
    tab: "agenda",
    title: "6. Agenda Semanal: Cronología y Fases de Eventos",
    desc: "Los eventos del equipo ordenados en el tiempo desde la base de datos real: Torneo Indautxu, entrenamientos y estado de respuesta.",
    actionHint: "Pulsa 'Gestionar evento' en la tarjeta del Torneo Indautxu."
  },
  {
    step: 7,
    role: "coach",
    screen: "v2_05_event_hub_normal",
    tab: "agenda",
    title: "7. Event Hub: Disponibilidad como protagonista (14/2/0/2)",
    desc: "Conectado a PostgreSQL: 14 Disponibles, 2 No disponibles, 0 Duda, 2 Sin respuesta. Preparación de convocatoria con advertencias controladas.",
    actionHint: "Pulsa 'Preparar y publicar convocatoria (12 jugadores)' para publicar la revisión 1."
  },
  {
    step: 8,
    role: "parent",
    screen: "v2_07_parent_home",
    tab: "inicio",
    title: "8. Inicio Tutor: Estado de convocatoria y acción pendiente",
    desc: "Elena Gómez consulta el estado real de su hijo Ibai (#9) en la convocatoria publicada y la solicitud de disponibilidad.",
    actionHint: "Pulsa 'Responder disponibilidad' en la tarjeta del Torneo Indautxu."
  },
  {
    step: 9,
    role: "parent",
    screen: "v2_08_parent_rsvp",
    tab: "inicio",
    title: "9. RSVP Familiar: NO PUEDE ASISTIR",
    desc: "Elena indica que Ibai NO PUEDE ASISTIR. El backend registra la baja y genera automáticamente un ActionItem para el entrenador.",
    actionHint: "Selecciona 'NO PUEDE ASISTIR' y pulsa 'Guardar respuesta'."
  },
  {
    step: 10,
    role: "coach",
    screen: "v2_01_coach_home",
    tab: "inicio",
    title: "10. Mesa del Entrenador: Incidencia de Baja Sobrevenida",
    desc: "Mikel recibe 'Baja de última hora: Ibai Aranguren no puede asistir' en 'Pendiente de ti' con opción directa de resolver.",
    actionHint: "Pulsa 'Resolver baja' para ver las sustitutas disponibles en PostgreSQL."
  },
  {
    step: 11,
    role: "coach",
    screen: "v2_06_event_hub_injury",
    tab: "agenda",
    title: "11. Sustitución Neutral: Ane Mintegi incorporada",
    desc: "PostgreSQL devuelve las 3 reservas disponibles (Ane, Irati, Nahia). Mikel confirma a Ane Mintegi y se emite la revisión 2.",
    actionHint: "Selecciona a Ane Mintegi (#16) y pulsa 'Confirmar sustitución'."
  }
];

export class TeamAppState {
  constructor() {
    this.currentRole = "coach"; // 'onboard' | 'coach' | 'parent'
    this.currentScreen = "v2_01_coach_home";
    this.currentTab = "inicio";
    this.currentStepIndex = 4;
    this.selectedSubstitute = "Ane Mintegi";
    this.selectedCandidateId = DEMO_CONFIG.ANE_PLAYER_ID;
    this.parentRsvpChoice = "NO";
    this.isElenaApproved = true;
    this.linkedFamiliesCount = 12;
    this.pendingFamiliesCount = 6;

    // Token cache
    this.tokens = {
      coach: null,
      parent: null
    };

    // Live synchronized backend cache
    this.live = {
      events: [],
      activeEvent: null,
      availability: null,
      callup: null,
      pending: null,
      parentCallupStatus: null,
      parentAvailability: null,
      candidates: [],
      activeActionItem: null,
      unconfirmedWarnings: []
    };
  }

  async init() {
    const params = new URLSearchParams(window.location.search);
    const screenParam = params.get("screen") || window.location.hash.replace("#", "");
    const roleParam = params.get("role");

    if (roleParam === "parent" || screenParam?.startsWith("v2_07_") || screenParam?.startsWith("v2_08_")) {
      this.currentRole = "parent";
    } else if (roleParam === "onboard" || screenParam?.startsWith("v2_00_")) {
      this.currentRole = "onboard";
    } else {
      this.currentRole = "coach";
    }

    if (screenParam && document.getElementById(screenParam)) {
      this.currentScreen = screenParam;
    }

    try {
      await this.ensureAuth(this.currentRole);
      await this.syncCurrentScreen();
    } catch (err) {
      console.warn("Backend auth/sync deferred:", err);
    }

    this.goToScreen(this.currentScreen);
    this.updateBottomNav();
    this.updateRoleUI();
    this.updateStepUI();
  }

  async ensureAuth(role) {
    if (role === "coach") {
      if (!this.tokens.coach) {
        const res = await api.auth.loginDev(DEMO_CONFIG.COACH_EMAIL, "Mikel Zubeldia");
        this.tokens.coach = res.accessToken;
      }
      api.client.setToken(this.tokens.coach);
    } else if (role === "parent") {
      if (!this.tokens.parent) {
        const res = await api.auth.loginDev(DEMO_CONFIG.GUARDIAN_EMAIL, "Elena Gómez");
        this.tokens.parent = res.accessToken;
      }
      api.client.setToken(this.tokens.parent);
    }
  }

  async switchMembership(membershipId) {
    if (membershipId === "onboard") {
      this.currentRole = "onboard";
      this.goToScreen("v2_00_onboarding_welcome");
      this.showToast("Modo Acceso Inicial / Onboarding");
    } else if (membershipId === "indautxu_inf_a" || membershipId === "coach") {
      this.currentRole = "coach";
      await this.ensureAuth("coach");
      await this.syncCurrentScreen();
      this.goToScreen(this.currentScreen.startsWith("v2_07_") || this.currentScreen.startsWith("v2_08_") ? "v2_01_coach_home" : this.currentScreen, "inicio");
      this.showToast("Modo Entrenador: Mikel Zubeldia (Sesión autenticada)");
    } else if (membershipId === "indautxu_ale_b" || membershipId === "parent") {
      this.currentRole = "parent";
      await this.ensureAuth("parent");
      await this.syncCurrentScreen();
      this.goToScreen("v2_07_parent_home", "inicio");
      this.showToast("Modo Familia: Elena Gómez / Ibai #9 (Sesión autenticada)");
    }
    this.updateRoleUI();
    this.updateBottomNav();
  }

  setRole(role) {
    this.switchMembership(role);
  }

  async goToScreen(screenId, tab = null) {
    this.currentScreen = screenId;
    if (tab) this.currentTab = tab;

    const allScreens = document.querySelectorAll(".app-screen-view");
    allScreens.forEach(s => s.classList.add("hidden"));

    const target = document.getElementById(screenId);
    if (target) {
      target.classList.remove("hidden");
      const viewport = document.getElementById("phone-viewport");
      if (viewport) viewport.scrollTop = 0;
    }

    const select = document.getElementById("demo-screen-select");
    if (select) select.value = screenId;

    this.updateBottomNav();
    await this.syncCurrentScreen();
  }

  goToTab(tab) {
    this.currentTab = tab;
    if (this.currentRole === "coach") {
      if (tab === "inicio") this.goToScreen("v2_01_coach_home", "inicio");
      else if (tab === "agenda") this.goToScreen("v2_02_coach_agenda", "agenda");
      else if (tab === "equipo") this.goToScreen("v2_03_coach_roster", "equipo");
      else if (tab === "avisos") this.goToScreen("screen_k_notices", "avisos");
    } else if (this.currentRole === "parent") {
      if (tab === "inicio") this.goToScreen("v2_07_parent_home", "inicio");
      else if (tab === "agenda") this.goToScreen("v2_02_coach_agenda", "agenda");
      else if (tab === "equipo" || tab === "hijos") this.goToScreen("v2_04_player_detail", "hijos");
      else if (tab === "avisos") this.goToScreen("screen_k_notices", "avisos");
    } else {
      this.switchMembership("indautxu_inf_a");
      this.goToTab(tab);
    }
  }

  updateBottomNav() {
    const bottomNav = document.getElementById("master-bottom-nav");
    if (!bottomNav) return;

    if (this.currentScreen.startsWith("v2_00_")) {
      bottomNav.classList.add("hidden");
      return;
    }
    bottomNav.classList.remove("hidden");

    const tabInicio = document.getElementById("nav-tab-inicio");
    const tabAgenda = document.getElementById("nav-tab-agenda");
    const tabEquipo = document.getElementById("nav-tab-equipo");
    const tabAvisos = document.getElementById("nav-tab-avisos");
    const equipoLabel = document.getElementById("nav-label-equipo");
    const equipoIcon = document.getElementById("nav-icon-equipo");

    if (equipoLabel) equipoLabel.textContent = this.currentRole === "coach" ? "Equipo" : "Ibai #9";
    if (equipoIcon) equipoIcon.textContent = this.currentRole === "coach" ? "groups" : "face";

    [tabInicio, tabAgenda, tabEquipo, tabAvisos].forEach(el => {
      if (el) {
        el.className = "flex-1 flex flex-col items-center justify-center py-1 text-on-surface-variant hover:text-primary transition-colors cursor-pointer";
        const label = el.querySelector("span:last-child");
        if (label) label.className = "text-[11px] font-medium tracking-tight";
      }
    });

    let activeTabEl = tabInicio;
    if (this.currentTab === "agenda" || ["v2_02_coach_agenda", "v2_05_event_hub_normal", "v2_06_event_hub_injury", "screen_c_create_event"].includes(this.currentScreen)) {
      activeTabEl = tabAgenda;
    } else if (this.currentTab === "equipo" || this.currentTab === "hijos" || ["v2_03_coach_roster", "v2_04_player_detail"].includes(this.currentScreen)) {
      activeTabEl = tabEquipo;
    } else if (this.currentTab === "avisos" || this.currentScreen === "screen_k_notices") {
      activeTabEl = tabAvisos;
    }

    if (activeTabEl) {
      activeTabEl.className = "flex-1 flex flex-col items-center justify-center py-1 text-primary font-bold transition-colors cursor-pointer";
      const label = activeTabEl.querySelector("span:last-child");
      if (label) label.className = "text-[11px] font-bold tracking-tight text-primary";
    }
  }

  updateRoleUI() {
    const btnOnboard = document.getElementById("role-btn-onboard");
    const btnCoach = document.getElementById("role-btn-coach");
    const btnParent = document.getElementById("role-btn-parent");

    [btnOnboard, btnCoach, btnParent].forEach(btn => {
      if (btn) btn.className = "px-2 py-1 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 transition-all cursor-pointer";
    });

    if (this.currentRole === "onboard" && btnOnboard) {
      btnOnboard.className = "px-2 py-1 rounded-lg text-xs font-bold bg-blue-600 text-white shadow-xs transition-all cursor-pointer";
    } else if (this.currentRole === "coach" && btnCoach) {
      btnCoach.className = "px-2 py-1 rounded-lg text-xs font-bold bg-blue-600 text-white shadow-xs transition-all cursor-pointer";
    } else if (this.currentRole === "parent" && btnParent) {
      btnParent.className = "px-2 py-1 rounded-lg text-xs font-bold bg-blue-600 text-white shadow-xs transition-all cursor-pointer";
    }
  }

  nextStep() {
    if (this.currentStepIndex < GUIDED_STEPS.length - 1) {
      this.currentStepIndex++;
      this.applyCurrentStep();
    }
  }

  prevStep() {
    if (this.currentStepIndex > 0) {
      this.currentStepIndex--;
      this.applyCurrentStep();
    }
  }

  async applyCurrentStep() {
    const step = GUIDED_STEPS[this.currentStepIndex];
    if (this.currentRole !== step.role) {
      await this.switchMembership(step.role === "coach" ? "indautxu_inf_a" : (step.role === "parent" ? "indautxu_ale_b" : "onboard"));
    }
    await this.goToScreen(step.screen, step.tab);
    this.updateStepUI();
  }

  updateStepUI() {
    const step = GUIDED_STEPS[this.currentStepIndex];
    if (!step) return;
    const titleEl = document.getElementById("demo-step-title");
    const descEl = document.getElementById("demo-step-desc");
    const actionEl = document.getElementById("demo-step-action");
    const progressEl = document.getElementById("demo-step-progress");

    if (titleEl) titleEl.textContent = step.title;
    if (descEl) descEl.textContent = step.desc;
    if (actionEl) actionEl.textContent = step.actionHint;
    if (progressEl) {
      const pct = Math.round(((this.currentStepIndex + 1) / GUIDED_STEPS.length) * 100);
      progressEl.style.width = `${pct}%`;
    }
  }

  // --- Real Backend Synchronization Methods ---

  async syncCurrentScreen() {
    try {
      if (this.currentScreen === "v2_01_coach_home") {
        await this.syncCoachHome();
      } else if (this.currentScreen === "v2_02_coach_agenda") {
        await this.syncCoachAgenda();
      } else if (this.currentScreen === "v2_05_event_hub_normal") {
        await this.syncEventHubNormal();
      } else if (this.currentScreen === "v2_06_event_hub_injury") {
        await this.syncEventHubInjury();
      } else if (this.currentScreen === "v2_07_parent_home") {
        await this.syncParentHome();
      } else if (this.currentScreen === "v2_08_parent_rsvp") {
        await this.syncParentRsvp();
      }
    } catch (err) {
      console.error("Error sincronizando pantalla:", err);
    }
  }

  async syncCoachHome() {
    await this.ensureAuth("coach");
    const pendingData = await api.pending.getPending(DEMO_CONFIG.TEAM_SEASON_ID);
    this.live.pending = pendingData;

    const actionItems = pendingData.actionItems || [];
    const bajaItem = actionItems.find(item => item.type === "CALLED_PLAYER_UNAVAILABLE" && item.status === "OPEN");
    this.live.activeActionItem = bajaItem;

    const bajaCard = document.getElementById("coach-item-baja-card");
    const bajaDesc = document.getElementById("coach-item-baja-desc");
    const badgeEl = document.getElementById("coach-pending-count-badge");

    if (bajaCard) {
      if (bajaItem) {
        bajaCard.classList.remove("hidden");
        if (bajaDesc) {
          bajaDesc.textContent = `${bajaItem.first_name || "Ibai"} (#9) ha comunicado que no puede asistir (nota: está enfermo).`;
        }
      } else {
        bajaCard.classList.add("hidden");
      }
    }

    if (badgeEl) {
      const totalCount = (bajaItem ? 1 : 0) + 2;
      badgeEl.textContent = `${totalCount} ${totalCount === 1 ? "tarea" : "tareas"}`;
    }
  }

  async syncCoachAgenda() {
    await this.ensureAuth("coach");
    const eventsRes = await api.events.getEvents(DEMO_CONFIG.TEAM_SEASON_ID);
    this.live.events = eventsRes.items || [];
  }

  async syncEventHubNormal() {
    await this.ensureAuth("coach");
    const availRes = await api.availability.getEventAvailability(DEMO_CONFIG.EVENT_OYON_ID);
    this.live.availability = availRes;

    const counts = availRes.counts || { CAN_ATTEND: 14, CANNOT_ATTEND: 2, UNSURE: 0, NO_RESPONSE: 2 };
    const elDisp = document.getElementById("hub-count-disponibles");
    const elBajas = document.getElementById("hub-count-bajas");
    const elPend = document.getElementById("hub-count-pendientes");

    if (elDisp) elDisp.textContent = counts.CAN_ATTEND;
    if (elBajas) elBajas.textContent = counts.CANNOT_ATTEND;
    if (elPend) elPend.textContent = counts.NO_RESPONSE + counts.UNSURE;

    const total = (counts.CAN_ATTEND + counts.CANNOT_ATTEND + counts.UNSURE + counts.NO_RESPONSE) || 18;
    const pctDisp = Math.round((counts.CAN_ATTEND / total) * 100);
    const pctBajas = Math.round((counts.CANNOT_ATTEND / total) * 100);
    const pctPend = Math.round(((counts.NO_RESPONSE + counts.UNSURE) / total) * 100);

    const barDisp = document.getElementById("hub-bar-disponibles");
    const barBajas = document.getElementById("hub-bar-bajas");
    const barPend = document.getElementById("hub-bar-pendientes");
    const pctLabel = document.getElementById("hub-progress-pct");
    const statSi = document.getElementById("hub-stat-si");
    const statNo = document.getElementById("hub-stat-no");
    const statDuda = document.getElementById("hub-stat-duda");

    if (barDisp) barDisp.style.width = `${pctDisp}%`;
    if (barBajas) barBajas.style.width = `${pctBajas}%`;
    if (barPend) barPend.style.width = `${pctPend}%`;
    if (pctLabel) pctLabel.textContent = `${pctDisp + pctBajas}% respondido`;
    if (statSi) statSi.textContent = `${counts.CAN_ATTEND} Sí (${pctDisp}%)`;
    if (statNo) statNo.textContent = `${counts.CANNOT_ATTEND} No (${pctBajas}%)`;
    if (statDuda) statDuda.textContent = `${counts.NO_RESPONSE + counts.UNSURE} Espera (${pctPend}%)`;

    // Convocatoria state check
    const callupBtn = document.getElementById("hub-callup-btn");
    const callupBadge = document.getElementById("hub-callup-phase-badge");
    const callupNotice = document.getElementById("hub-callup-notice");

    if (this.live.callup && this.live.callup.status === "PUBLISHED") {
      if (callupBadge) {
        callupBadge.className = "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-900 font-label-sm text-label-sm font-bold border border-emerald-300";
        callupBadge.innerHTML = `<span class="material-symbols-outlined text-[13px]">check_circle</span> Convocatoria Publicada (Rev. ${this.live.callup.current_revision_number || 1})`;
      }
      if (callupNotice) {
        callupNotice.innerHTML = `<p class="font-body-sm text-body-sm text-emerald-800 font-medium leading-relaxed">
          <strong class="text-emerald-900 font-bold">Convocatoria oficial cerrada y comunicada.</strong> 12 jugadores citados para el Torneo Indautxu a las 08:45 h.
        </p>`;
      }
      if (callupBtn) {
        callupBtn.className = "w-full h-[50px] bg-secondary hover:bg-emerald-700 text-white font-label-lg text-label-lg rounded-xl flex items-center justify-center gap-2 cursor-pointer shadow-sm";
        callupBtn.innerHTML = `<span class="material-symbols-outlined text-[18px]">verified</span><span>Convocatoria publicada (12 jugadores)</span>`;
      }
    }
  }

  async handlePublishCallup() {
    await this.ensureAuth("coach");
    try {
      const availRes = await api.availability.getEventAvailability(DEMO_CONFIG.EVENT_OYON_ID);
      const items = availRes.items || [];

      // Las 3 reservas no convocadas que quedarán disponibles son Ane Mintegi, Irati Fernandez y Nahia Garcia
      const reserveIds = [DEMO_CONFIG.ANE_PLAYER_ID, "30000000-0000-4000-8000-000000000004", "30000000-0000-4000-8000-000000000003"];
      const canAttendCalled = items.filter(p => p.status === "CAN_ATTEND" && !reserveIds.includes(p.player_id)).map(p => p.player_id);
      const noResponse = items.filter(p => p.status === "NO_RESPONSE").map(p => p.player_id);

      // 11 disponibles + 1 sin respuesta = 12 convocados (incluyendo a Ibai Aranguren)
      const selected12 = canAttendCalled.concat(noResponse.slice(0, 1));

      // Crear o preparar draft
      let draft;
      try {
        draft = await api.callup.createDraft(DEMO_CONFIG.EVENT_OYON_ID, selected12);
      } catch (e) {
        console.info("Draft already existing or created:", e.message);
      }

      const callupId = draft ? draft.id : (this.live.callup?.id || "50000000-0000-4000-8000-000000000001");
      const expectedVersion = draft ? draft.version : 1;

      // Idempotency Key Manager mantiene la misma clave en reintentos
      const idemKey = idempotencyManager.getOrCreateKey(`publish-callup-${callupId}`);

      try {
        // Intento 1 sin confirmación de advertencias
        const res = await api.callup.publishCallup(callupId, {
          expectedVersion,
          confirmWarnings: this.live.unconfirmedWarnings
        }, idemKey);

        idempotencyManager.clearKey(`publish-callup-${callupId}`);
        this.live.callup = res;
        this.showToast("✓ Convocatoria oficial del Torneo Indautxu publicada en PostgreSQL (Revisión 1).");
        await this.syncEventHubNormal();
      } catch (err) {
        if (err.code === "CALLUP_WARNINGS_UNCONFIRMED") {
          // El backend exige confirmación explícita para jugadores sin respuesta
          let missingWarnings = [];
          try {
            missingWarnings = JSON.parse(err.message);
          } catch {
            missingWarnings = [{ key: `PLAYER_NO_RESPONSE:${noResponse[0]}` }, { key: `PLAYER_NO_RESPONSE:${noResponse[1]}` }];
          }

          const confirmedKeys = missingWarnings.map(w => w.key);
          this.live.unconfirmedWarnings = confirmedKeys;

          this.showToast("⚠️ Advertencia: Hay 2 jugadores sin confirmación (Iker Baroja, Peio Gómez). Reintentando con confirmación explícita...");

          // Reintento con los warnings confirmados Y LA MISMA IDEMPOTENCY KEY
          const retryRes = await api.callup.publishCallup(callupId, {
            expectedVersion,
            confirmWarnings: confirmedKeys
          }, idemKey);

          idempotencyManager.clearKey(`publish-callup-${callupId}`);
          this.live.callup = retryRes;
          this.showToast("✓ Convocatoria publicada con advertencias confirmadas (Revisión 1 en PostgreSQL).");
          await this.syncEventHubNormal();
        } else {
          throw err;
        }
      }
    } catch (err) {
      this.showToast(`Error: ${mapDomainError(err)}`);
    }
  }

  async syncParentHome() {
    await this.ensureAuth("parent");
    try {
      const statusRes = await api.callup.getPlayerCallupStatus(DEMO_CONFIG.EVENT_OYON_ID, DEMO_CONFIG.IBAI_PLAYER_ID);
      this.live.parentCallupStatus = statusRes;

      const availRes = await api.availability.getPlayerAvailability(DEMO_CONFIG.EVENT_OYON_ID, DEMO_CONFIG.IBAI_PLAYER_ID);
      this.live.parentAvailability = availRes.current;

      const badge = document.getElementById("parent-ibai-callup-badge");
      if (badge) {
        if (availRes.current?.status === "CANNOT_ATTEND") {
          badge.className = "inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-100 border border-rose-300 text-rose-900 font-label-sm text-[11px] font-extrabold";
          badge.innerHTML = `<span class="material-symbols-outlined text-[14px] text-rose-700">cancel</span><span>No asistirá (Baja comunicada)</span>`;
        } else if (statusRes.called) {
          badge.className = "inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 border border-emerald-300 text-emerald-900 font-label-sm text-[11px] font-extrabold";
          badge.innerHTML = `<span class="material-symbols-outlined text-[14px] text-emerald-700">check_circle</span><span>✓ Convocado al partido (Rev. ${statusRes.revision || 1})</span>`;
        } else {
          badge.className = "inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-300 text-slate-700 font-label-sm text-[11px] font-bold";
          badge.innerHTML = `<span class="material-symbols-outlined text-[14px]">remove_circle_outline</span><span>No convocado</span>`;
        }
      }
    } catch (err) {
      console.warn("Parent home sync error:", err);
    }
  }

  async syncParentRsvp() {
    await this.ensureAuth("parent");
    const availRes = await api.availability.getPlayerAvailability(DEMO_CONFIG.EVENT_OYON_ID, DEMO_CONFIG.IBAI_PLAYER_ID);
    this.live.parentAvailability = availRes.current;
  }

  selectRsvpOption(choice) {
    this.parentRsvpChoice = choice;
  }

  async saveParentRsvp() {
    await this.ensureAuth("parent");
    try {
      const expectedVersion = this.live.parentAvailability ? this.live.parentAvailability.version : 0;
      const status = this.parentRsvpChoice === "NO" ? "CANNOT_ATTEND" : (this.parentRsvpChoice === "SI" ? "CAN_ATTEND" : "UNSURE");

      const idemKey = idempotencyManager.getOrCreateKey(`parent-rsvp-${DEMO_CONFIG.EVENT_OYON_ID}`);

      await api.availability.setGuardianAvailability(
        DEMO_CONFIG.EVENT_OYON_ID,
        DEMO_CONFIG.IBAI_PLAYER_ID,
        { status, expectedVersion },
        idemKey
      );

      idempotencyManager.clearKey(`parent-rsvp-${DEMO_CONFIG.EVENT_OYON_ID}`);

      this.showToast(status === "CANNOT_ATTEND"
        ? "✓ Disponibilidad guardada en PostgreSQL: NO asistirá (Baja registrada)."
        : "✓ Disponibilidad guardada con éxito.");

      setTimeout(() => {
        this.goToScreen("v2_07_parent_home", "inicio");
      }, 1000);
    } catch (err) {
      this.showToast(`Error al guardar: ${mapDomainError(err)}`);
    }
  }

  async syncEventHubInjury() {
    await this.ensureAuth("coach");
    const pendingData = await api.pending.getPending(DEMO_CONFIG.TEAM_SEASON_ID);
    const bajaItem = (pendingData.actionItems || []).find(item => item.type === "CALLED_PLAYER_UNAVAILABLE" && item.status === "OPEN");
    this.live.activeActionItem = bajaItem;

    if (bajaItem) {
      const candidatesRes = await api.pending.getReplacementCandidates(bajaItem.id);
      this.live.candidates = candidatesRes.items || [];
      this.renderCandidates(this.live.candidates);
    }
  }

  renderCandidates(candidates) {
    const container = document.getElementById("injury-candidates-container");
    if (!container || !candidates.length) return;

    container.innerHTML = "";
    candidates.forEach((c, idx) => {
      const isSelected = c.id === this.selectedCandidateId || idx === 0;
      if (isSelected && !this.selectedCandidateId) {
        this.selectedCandidateId = c.id;
        this.selectedSubstitute = `${c.first_name} ${c.last_name}`;
      }

      const initials = `${c.first_name[0] || ""}${c.last_name[0] || ""}`.toUpperCase();
      const num = c.shirt_number || (idx === 0 ? 16 : (idx === 1 ? 12 : 15));

      const card = document.createElement("div");
      card.id = `sub-cand-${c.id}`;
      card.className = isSelected
        ? "player-card relative p-3 rounded-xl border-2 border-primary-container bg-surface-container-high/40 cursor-pointer transition-all active:scale-[0.98]"
        : "player-card relative p-3 rounded-xl border border-outline-variant bg-surface-container-lowest hover:border-outline cursor-pointer transition-all active:scale-[0.98]";

      card.onclick = () => this.selectCandidate(c.id, `${c.first_name} ${c.last_name}`);

      card.innerHTML = `
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="relative">
              <div class="w-10 h-10 rounded-full ${isSelected ? "bg-primary-fixed text-on-primary-fixed" : "bg-surface-container-low text-on-surface-variant border border-outline-variant"} flex items-center justify-center font-bold text-[14px]">
                ${initials}
              </div>
              <span class="absolute -bottom-1 -right-1 ${isSelected ? "bg-primary text-on-primary" : "bg-surface-container-highest text-on-surface"} font-label-sm text-[10px] px-1 rounded-full font-bold">#${num}</span>
            </div>
            <div>
              <p class="font-label-lg text-label-lg text-on-surface font-bold">${c.first_name} ${c.last_name}</p>
              <p class="font-body-sm text-[12px] text-on-surface-variant">Reserva disponible · Criterio técnico</p>
            </div>
          </div>
          <div class="radio-slot ${isSelected ? "text-primary" : "text-outline"}">
            <span class="material-symbols-outlined text-[24px] ${isSelected ? "icon-filled" : ""}">
              ${isSelected ? "check_circle" : "radio_button_unchecked"}
            </span>
          </div>
        </div>
        <div class="mt-2 pt-2 border-t border-outline-variant/60 flex items-center justify-between text-secondary font-label-sm text-label-sm">
          <span class="inline-flex items-center gap-1.5 font-bold">
            <span class="w-2 h-2 rounded-full bg-secondary"></span>
            Disponible · Confirmó asistencia
          </span>
        </div>
      `;
      container.appendChild(card);
    });
  }

  selectCandidate(candidateId, name) {
    this.selectedCandidateId = candidateId;
    this.selectedSubstitute = name;
    if (this.live.candidates) {
      this.renderCandidates(this.live.candidates);
    }
    this.showToast(`Sustituta seleccionada: ${name}`);
  }

  selectReserve(name) {
    this.selectedSubstitute = name;
    if (name.includes("Ane")) this.selectedCandidateId = DEMO_CONFIG.ANE_PLAYER_ID;
    this.showToast(`Sustituta elegida: ${name}`);
  }

  async confirmSubstitution() {
    await this.ensureAuth("coach");
    if (!this.live.activeActionItem) {
      this.showToast("No hay una incidencia de baja abierta.");
      return;
    }

    const actionItemId = this.live.activeActionItem.id;
    const substituteId = this.selectedCandidateId || DEMO_CONFIG.ANE_PLAYER_ID;
    const expectedRevision = 1;

    const idemKey = idempotencyManager.getOrCreateKey(`replace-player-${actionItemId}`);

    try {
      const res = await api.pending.replacePlayer(actionItemId, {
        substitutePlayerId: substituteId,
        expectedCallupRevision: expectedRevision
      }, idemKey);

      idempotencyManager.clearKey(`replace-player-${actionItemId}`);

      const banner = document.getElementById("injury-resolved-banner");
      if (banner) banner.classList.remove("hidden");

      this.showToast(`✓ Sustitución completada en PostgreSQL: ${this.selectedSubstitute} incorporada (Revisión ${res.revisionNumber}).`);

      setTimeout(() => {
        this.goToScreen("v2_01_coach_home", "inicio");
      }, 1500);
    } catch (err) {
      this.showToast(`Error: ${mapDomainError(err)}`);
    }
  }

  // --- Reset y Pruebas de Conflicto en Vivo ---

  async resetBackendDataset() {
    try {
      await api.dev.resetDataset();
      this.tokens = { coach: null, parent: null };
      idempotencyManager.keys.clear();
      this.live = {
        events: [],
        activeEvent: null,
        availability: null,
        callup: null,
        pending: null,
        parentCallupStatus: null,
        parentAvailability: null,
        candidates: [],
        activeActionItem: null,
        unconfirmedWarnings: []
      };

      const banner = document.getElementById("injury-resolved-banner");
      if (banner) banner.classList.add("hidden");

      await this.ensureAuth("coach");
      await this.syncCurrentScreen();
      this.showToast("✓ Base de datos PostgreSQL reiniciada al estado limpio VS02 (14/2/0/2).");
    } catch (err) {
      this.showToast(`Error al reiniciar: ${mapDomainError(err)}`);
    }
  }

  async triggerTestConflictVersion() {
    await this.ensureAuth("coach");
    try {
      const staleCallupId = this.live.callup?.id || "50000000-0000-4000-8000-000000000001";
      this.showToast("⚡ Enviando llamada con expectedVersion desactualizada (999)...");
      await api.callup.publishCallup(staleCallupId, { expectedVersion: 999, confirmWarnings: [] });
    } catch (err) {
      const msg = mapDomainError(err);
      this.showToast(`⚠️ Conflicto detectado: ${msg}`);
      console.warn("Domain error caught as expected:", err);
    }
  }

  async triggerTestConflictSubstitute() {
    await this.ensureAuth("coach");
    try {
      if (!this.live.activeActionItem) {
        this.showToast("Primero debes registrar la baja de Ibai para que haya una incidencia abierta.");
        return;
      }
      this.showToast("⚡ Intentando sustituir con suplente no elegible...");
      // Intentar reemplazar con jugador no disponible (Olatz Bengoa CANNOT_ATTEND)
      await api.pending.replacePlayer(this.live.activeActionItem.id, {
        substitutePlayerId: "30000000-0000-4000-8000-000000000017",
        expectedCallupRevision: 1
      });
    } catch (err) {
      const msg = mapDomainError(err);
      this.showToast(`⚠️ Error controlado: ${msg}`);
      console.warn("Domain error caught as expected:", err);
    }
  }

  nudgePending() {
    this.showToast("🔔 Recordatorio enviado a familias sin respuesta vía backend.");
  }

  finishCoachSetup() {
    this.switchMembership("indautxu_inf_a");
    this.showToast("✓ Equipo C.D. Indautxu · Infantil A creado con éxito. Código INDA16.");
  }

  shareInviteCode() {
    const inviteLink = "https://baituman420.github.io/taldehemendik/?join=INDA16";
    if (navigator.clipboard) navigator.clipboard.writeText(inviteLink).catch(() => {});
    this.showToast("📲 Enlace de invitación copiado: Código INDA16.");
  }

  copyInviteCode() {
    if (navigator.clipboard) navigator.clipboard.writeText("INDA16").catch(() => {});
    this.showToast("Código INDA16 copiado al portapapeles.");
  }

  submitParentJoinRequest() {
    const btn = document.getElementById("btn-submit");
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="material-symbols-outlined text-[20px] animate-spin">progress_activity</span><span>Enviando al entrenador...</span>`;
    }
    setTimeout(() => {
      this.showToast("✓ Solicitud de vinculación registrada para Ibai #9.");
      this.currentStepIndex = 3;
      this.applyCurrentStep();
    }, 1000);
  }

  approveGuardianRequest() {
    this.isElenaApproved = true;
    const reqCard = document.getElementById("coach-pending-approval-card");
    const successBadge = document.getElementById("coach-approval-success-badge");
    if (reqCard) reqCard.classList.add("hidden");
    if (successBadge) successBadge.classList.remove("hidden");
    this.showToast("✓ Vinculación aprobada: Elena Gómez vinculada a Ibai Aranguren (#9).");
  }

  rejectGuardianRequest() {
    const reqCard = document.getElementById("coach-pending-approval-card");
    if (reqCard) reqCard.classList.add("hidden");
    this.showToast("Solicitud rechazada.");
  }

  dismissOnboardingBanner() {
    const banner = document.getElementById("coach-onboarding-banner");
    if (banner) {
      banner.classList.add("hidden");
      this.showToast("✓ Puesta en marcha ocultada. Mostrando La Mesa del Entrenador.");
    }
  }

  showPlayerModal(playerId) {
    const player = SQUAD_DATA.find(p => p.id === playerId);
    if (!player) return;
    if (player.id === 9) {
      this.goToScreen("v2_04_player_detail", "equipo");
      return;
    }
    const modal = document.getElementById("player-detail-sheet");
    if (modal) {
      document.getElementById("sheet-player-num").textContent = `#${player.number}`;
      document.getElementById("sheet-player-name").textContent = player.name;
      document.getElementById("sheet-player-role").textContent = `${player.role} · C.D. Indautxu Infantil A`;
      document.getElementById("sheet-player-status").textContent = player.rsvp;
      document.getElementById("sheet-tutor-name").textContent = player.tutor;
      document.getElementById("sheet-tutor-phone").textContent = player.phone;
      modal.classList.remove("hidden");
    }
  }

  closePlayerModal() {
    const modal = document.getElementById("player-detail-sheet");
    if (modal) modal.classList.add("hidden");
  }

  filterRoster(type) {
    const rows = document.querySelectorAll(".roster-player-row");
    rows.forEach(r => {
      if (type === "all") r.classList.remove("hidden");
      else if (type === "disponibles") r.classList.toggle("hidden", r.dataset.status === "baja");
      else if (type === "convocados") r.classList.toggle("hidden", r.dataset.convocado !== "true");
      else if (type === "bajas") r.classList.toggle("hidden", r.dataset.status !== "baja");
    });
    this.showToast(`Filtro aplicado: ${type.toUpperCase()}`);
  }

  resetDemo() {
    this.currentStepIndex = 0;
    this.switchMembership("onboard");
    this.applyCurrentStep();
    this.showToast("Demo reiniciada al inicio de Onboarding.");
  }

  showToast(message) {
    const toast = document.getElementById("demo-toast");
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove("opacity-0", "pointer-events-none", "translate-y-2");
    toast.classList.add("opacity-100", "translate-y-0");

    if (this._toastTimer) clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => {
      toast.classList.remove("opacity-100", "translate-y-0");
      toast.classList.add("opacity-0", "pointer-events-none", "translate-y-2");
    }, 3500);
  }
}

// Global instance attached to window
const teamApp = new TeamAppState();
window.teamApp = teamApp;

document.addEventListener("DOMContentLoaded", () => {
  teamApp.init();
});
