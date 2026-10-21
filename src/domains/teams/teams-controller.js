/**
 * Talde Hemendik! — Teams Domain Controller (REV-02)
 * Gestiona el ciclo de vida de los equipos, plantillas y cambios de membresía.
 */

import { api, mapDomainError } from "../../api/index.js";

export class TeamsDomainController {
  constructor(app) {
    this.app = app;
  }

  get coordinator() {
    return this.app.contextCoordinator;
  }

  get store() {
    return this.app.resourceStore;
  }

  async switchTeam(teamSeasonId) {
    this.app._explicitIntentSeq = (this.app._explicitIntentSeq || 0) + 1;
    const myIntentSeq = this.app._explicitIntentSeq;
    const scope = this.app.createScope();

    if (this.app.appMode === "DEMO") {
      this.app.applyContextTransition({ teamSeasonId }, scope);
      return;
    }

    try {
      const res = await api.teams.getMyMemberships();
      if (myIntentSeq !== this.app._explicitIntentSeq) return;
      if (!this.app.isScopeActive(scope)) return;
      const items = res?.items || [];
      const targetMem = items.find(m => m.team_season_id === teamSeasonId && m.status === "ACTIVE");
      if (!targetMem) {
        throw new Error("No tienes membresía activa en este equipo.");
      }

      const isCoach = targetMem.role === "COACH";
      const guardianPlayers = isCoach ? [] : (targetMem.guardian_players || targetMem.guardianPlayers || []);
      const guardianPlayer = isCoach ? null : (guardianPlayers[0] || null);

      const ok = this.app.applyContextTransition({
        role: isCoach ? "coach" : "parent",
        teamSeasonId: targetMem.team_season_id,
        team: { id: targetMem.team_id, name: targetMem.team_name, sport: targetMem.sport },
        teamSeason: {
          id: targetMem.team_season_id,
          display_label: targetMem.display_label,
          season_label: targetMem.season_label,
          category: targetMem.category,
          join_code: targetMem.join_code
        },
        joinCode: targetMem.join_code,
        guardianPlayers,
        guardianPlayer
      }, scope);
      if (!ok) return;

      if (isCoach) {
        await this.app.goToScreen("v2_01_coach_home", "inicio");
      } else {
        await this.app.goToScreen("v2_07_parent_home", "inicio");
      }
    } catch (err) {
      if (myIntentSeq !== this.app._explicitIntentSeq) return;
      if (!this.app.isScopeActive(scope)) return;
      if (err?.status === 401 && err.wasAuthenticated) {
        this.app.handleSessionExpired(err, scope);
        return;
      }
      this.app.showToast(`Error al cambiar de equipo: ${mapDomainError(err)}`);
      throw err;
    }
  }
}
