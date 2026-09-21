# Talde Hemendik! ⚽

> **Aplicación mobile-first de gestión de equipos de deporte base.**  
> Diseñada alrededor del modelo mental real de entrenadores y familias: **sin burocracia, sin ruido y centrada en el evento.**

📱 **Demo Pública Navegable**: [https://baituman420.github.io/taldehemendik/](https://baituman420.github.io/taldehemendik/)

---

## 🎯 Visión del Producto

La mayoría de herramientas de gestión deportiva trasladan la lógica administrativa o federativa al campo. **Talde Hemendik!** invierte esta prioridad:

- **Para el Entrenador**: Conocer al instante qué requiere su atención hoy, quién asiste al próximo entreno o partido, y resolver incidencias (como bajas sobrevenidas) en segundos con un tratamiento neutral de suplentes.
- **Para las Familias**: Cero fricción. Responder la disponibilidad de su hijo/a en menos de 3 segundos (SÍ / NO / TODAVÍA NO LO SÉ) sin exponer datos de otros menores ni obligarles a navegar calendarios complejos.
- **Sin Scope Creep**: Sin datos médicos invasivos, sin burocracia federativa y con lenguaje natural de cantera (*Equipo, Convocatoria, Asistencia, Avisos*).

---

## 🏗️ Arquitectura Técnica

- **Mobile-First & Capacitor-Ready**: La experiencia está concebida desde el primer momento como aplicación móvil para **iOS y Android**, con acceso web complementario para incorporación rápida de familias mediante enlaces o código de invitación.
- **SPA Liviana y Autónoma**: Interfaz construida con componentes semánticos y Tailwind CSS, ejecutable directamente en el cliente sin requerir backend ni base de datos pesada para la demo interactiva.
- **Modelo de Datos Multi-Rol**:
  $$\text{USUARIO} \longrightarrow \text{EQUIPO} \longrightarrow \text{ROL} \ (\text{Entrenador / Tutor})$$
  Permite cambiar de contexto entre míster y familia con un solo toque.

---

## 👥 Datos de Demostración (Temporada 2026/27)

* **Club**: **S. D. Indautxu**
* **Equipo**: **Infantil A** (Fútbol Base)
* **Código de Invitación**: `INDA16`
* **Fecha de Referencia de la Demo**: **Viernes 18 de Septiembre de 2026**
* **Próximo Evento**: *Torneo Indautxu* · Sábado 19 de Septiembre, 09:30 h (Polideportivo Municipal Indautxu)

### Plantilla Maestra (18 Jugadores)

| # | Jugador | Posición | Estado Demo | Tutor / Contacto |
|---|---|---|---|---|
| **1** | Gorka Elejalde | Portero | Convocado | Iker Elejalde (611 22 33 44) |
| **2** | Eneko Zabala | Defensa Central | Convocado | Joseba Zabala (622 33 44 55) |
| **3** | Julen Ortiz | Defensa Lateral | Convocado | Xabier Ortiz (633 44 55 66) |
| **4** | Jon Beltrán | Defensa Central | Convocado | Iñaki Beltrán (644 55 66 77) |
| **5** | Markel Saenz | Centrocampista | Convocado | Elena Saenz (655 66 77 88) |
| **6** | Ander Lopez | Centrocampista | Convocado | Begoña Lopez (666 77 88 99) |
| **7** | Unai Martinez | Extremo Derecho | Convocado | Kepa Martinez (677 88 99 00) |
| **8** | Oier Gomez | Mediapunta | Convocado | Maite Gomez (688 99 00 11) |
| **9** | **Ibai Aranguren** | Delantero Centro | **No disponible** *(enfermo)* | **Elena Gómez** (620 44 55 66) |
| **10** | Mikel Zabaleta | Centrocampista | Convocado | Aitor Zabaleta (699 00 11 22) |
| **11** | Aimar Ortiz | Delantero | Convocado | Miren Ortiz (600 11 22 33) |
| **12** | Nahia Garcia | Centrocampista | Disponible · Reserva | Nerea Garcia (612 23 34 45) |
| **13** | Asier Urkijo | Centrocampista | No disponible *(viaje)* | Mikel Urkijo (623 34 45 56) |
| **14** | Iker Baroja | Extremo Izquierdo | Convocado | Carmen Baroja (634 45 56 67) |
| **15** | Irati Fernandez | Delantera | Disponible · Reserva | Patxi Fernandez (645 56 67 78) |
| **16** | **Ane Mintegi** | Centrocampista | **Sustituta elegida** | Iñaki Mintegi (644 55 66 77) |
| **17** | Olatz Bengoa | Defensa | No disponible | Sonia Bengoa (656 67 78 89) |
| **18** | Peio Gómez | Defensa | No disponible *(sin respuesta)* | Asier Gómez (667 78 89 90) |

---

## 🧭 Recorrido Guiado de la Demo (11 Pasos)

La demo incluye un controlador superior con selector de roles y un tour paso a paso:

1. **Acceso Inicial**: Selección de función (*Soy entrenador / staff* o *Soy padre, madre o tutor*).
2. **Alta de Equipo**: Generación del código de invitación `INDA16` para compartir por WhatsApp.
3. **Solicitud Familiar**: Elena Gómez solicita vincularse a su hijo Ibai (#9) con salvaguarda de privacidad.
4. **Puesta en Marcha**: El entrenador aprueba la vinculación de Elena en la mesa de trabajo.
5. **La Mesa del Entrenador**: Triage de prioridades (*3 cosas necesitan tu atención*).
6. **Agenda Semanal**: Vista cronológica (*Viernes 18 entreno, Sábado 19 torneo, Lunes 21 entreno*).
7. **Event Hub**: Fase de disponibilidad como protagonista con desglose de respuestas.
8. **Gestión de Incidencia**: Sustitución neutral de la baja de Ibai seleccionando a Ane Mintegi (#16).
9. **Plantilla & Ficha**: Listado completo de 18 jugadores y ficha individual con contacto familiar directo.
10. **Inicio Familia**: Vista personalizada para Elena Gómez enfocada únicamente en su hijo.
11. **RSVP en 3 Segundos**: Confirmación táctil instantánea con opción de nota privada para el míster.

---

## 💻 Desarrollo Local

Para ejecutar la demo localmente:

```bash
# Clonar el repositorio
git clone git@github.com:baituman420/taldehemendik.git
cd taldehemendik

# Servir con cualquier servidor HTTP local
python3 -m http.server 8000
# o bien:
npx serve .
```

Abre en tu navegador: [http://localhost:8000/](http://localhost:8000/)

### Ensamblado de Pantallas

Si modificas pantallas modulares en `stitch_screens/v2/`:

```bash
python3 assemble_v2.py
```
Esto regenerará `index.html` aplicando las reglas de coherencia y el shell interactivo de la aplicación.

---

## 🚀 Despliegue

El proyecto se despliega automáticamente en GitHub Pages mediante GitHub Actions (`.github/workflows/deploy.yml`) tras cada push a las ramas principales (`main`, `gh-pages`, `v2-mental-model-architecture`).
