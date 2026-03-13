import { randomUUID } from "crypto";

type DemoCourse = {
  id: string;
  slug: string;
  name: string;
  price_cents: number;
  active: boolean;
  track: string;
  area: string;
  workload_hours: number | null;
  modality: string;
  duration_months_min: number;
  duration_months_max: number;
  tcc_required: boolean;
  program_slug: string;
  program_name: string;
  track_requirements: Record<string, unknown>;
};

type DemoLeadRecord = {
  lead_status: string;
  lead_id: string;
  lead_code: string;
  course_slug: string;
  course_name: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  cpf: string | null;
  birth_date: string | null;
  father_name: string;
  mother_name: string;
  address: Record<string, unknown>;
  payment_status: string;
  payment_reference: string | null;
  payment_tid: string | null;
  payment_return_code: string | null;
  payment_return_message: string | null;
  created_at: string;
  payment_updated_at: string | null;
  paid_at: string | null;
  first_contact_at: string | null;
  contact_channel: string | null;
  contact_owner: string | null;
};

type DemoLeadIntentRecord = {
  intent_id: string;
  client_event_id: string;
  intent_type: string;
  course_slug: string | null;
  course_name: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  city: string | null;
  state: string | null;
  last_step: string;
  last_step_label: string;
  source_url: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  payload: Record<string, unknown>;
  created_at: string;
};

type DemoLeadLookupFilters = {
  leadCodePrefix: string | null;
  leadStatus: string | null;
  limit: number;
};

type DemoLeadUpdateInput = {
  leadId: string;
  leadStatus: string | null;
  contactChannel: string | null;
  contactOwner: string | null;
  shouldMarkFirstContact: boolean;
};

type DemoLeadCreateInput = {
  courseSlug: string | null;
  courseName?: string | null;
};

type DemoLeadIntentLookupFilters = {
  intentType: string;
  lastStepFilter: string | null;
  courseSlug: string | null;
  limit: number;
};

type DemoLeadIntentCreateInput = {
  hasMinimumData: boolean;
  intentType: string;
  courseSlug: string | null;
  courseName: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  city: string | null;
  state: string | null;
  lastStep: string;
  sourceUrl: string | null;
};

type DailyMetricTemplate = {
  daysAgo: number;
  visits: number;
  whatsapp_icon_clicks: number;
  whatsapp_handoffs: number;
  leads_created: number;
  leads_contacted: number;
  enrollments_completed: number;
};

type AttributionMetricTemplate = {
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
  visits: number;
  whatsapp_icon_clicks: number;
  whatsapp_handoffs: number;
  leads_created: number;
  leads_contacted: number;
  enrollments_completed: number;
};

const DEMO_DETAIL =
  "Ambiente de demonstracao: respostas mockadas, sem persistencia, sem pagamentos e sem integracoes externas.";
const DEMO_WHATSAPP_URL = "https://demo.escola-tecnica.example/painel";

const DEMO_COURSES: DemoCourse[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    slug: "administracao",
    name: "Tecnico em Administracao",
    price_cents: 219000,
    active: true,
    track: "regular",
    area: "administracao",
    workload_hours: 1340,
    modality: "EAD",
    duration_months_min: 6,
    duration_months_max: 12,
    tcc_required: true,
    program_slug: "administracao",
    program_name: "Tecnico em Administracao",
    track_requirements: {}
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    slug: "enfermagem",
    name: "Tecnico em Enfermagem",
    price_cents: 249000,
    active: true,
    track: "regular",
    area: "saude",
    workload_hours: 1800,
    modality: "EAD",
    duration_months_min: 12,
    duration_months_max: 18,
    tcc_required: true,
    program_slug: "enfermagem",
    program_name: "Tecnico em Enfermagem",
    track_requirements: {}
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    slug: "informatica",
    name: "Tecnico em Informatica",
    price_cents: 199000,
    active: true,
    track: "regular",
    area: "tecnologia",
    workload_hours: 1200,
    modality: "EAD",
    duration_months_min: 6,
    duration_months_max: 12,
    tcc_required: true,
    program_slug: "informatica",
    program_name: "Tecnico em Informatica",
    track_requirements: {}
  },
  {
    id: "10000000-0000-4000-8000-000000000004",
    slug: "seguranca-do-trabalho",
    name: "Tecnico em Seguranca do Trabalho",
    price_cents: 229000,
    active: true,
    track: "regular",
    area: "industria",
    workload_hours: 1200,
    modality: "EAD",
    duration_months_min: 6,
    duration_months_max: 12,
    tcc_required: true,
    program_slug: "seguranca-do-trabalho",
    program_name: "Tecnico em Seguranca do Trabalho",
    track_requirements: {}
  }
];

const DAILY_FUNNEL_TEMPLATE: DailyMetricTemplate[] = [
  {
    daysAgo: 6,
    visits: 24,
    whatsapp_icon_clicks: 8,
    whatsapp_handoffs: 5,
    leads_created: 3,
    leads_contacted: 2,
    enrollments_completed: 0
  },
  {
    daysAgo: 5,
    visits: 31,
    whatsapp_icon_clicks: 11,
    whatsapp_handoffs: 6,
    leads_created: 4,
    leads_contacted: 3,
    enrollments_completed: 1
  },
  {
    daysAgo: 4,
    visits: 18,
    whatsapp_icon_clicks: 6,
    whatsapp_handoffs: 4,
    leads_created: 2,
    leads_contacted: 1,
    enrollments_completed: 0
  },
  {
    daysAgo: 3,
    visits: 27,
    whatsapp_icon_clicks: 9,
    whatsapp_handoffs: 5,
    leads_created: 3,
    leads_contacted: 2,
    enrollments_completed: 1
  },
  {
    daysAgo: 2,
    visits: 22,
    whatsapp_icon_clicks: 7,
    whatsapp_handoffs: 4,
    leads_created: 2,
    leads_contacted: 2,
    enrollments_completed: 0
  },
  {
    daysAgo: 1,
    visits: 29,
    whatsapp_icon_clicks: 10,
    whatsapp_handoffs: 6,
    leads_created: 4,
    leads_contacted: 3,
    enrollments_completed: 1
  },
  {
    daysAgo: 0,
    visits: 15,
    whatsapp_icon_clicks: 5,
    whatsapp_handoffs: 3,
    leads_created: 1,
    leads_contacted: 1,
    enrollments_completed: 0
  }
];

const ATTRIBUTION_TEMPLATE: AttributionMetricTemplate[] = [
  {
    utm_source: "meta",
    utm_medium: "paid",
    utm_campaign: "demo_adm_2026",
    visits: 58,
    whatsapp_icon_clicks: 19,
    whatsapp_handoffs: 11,
    leads_created: 7,
    leads_contacted: 5,
    enrollments_completed: 1
  },
  {
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: "demo_brand_2026",
    visits: 42,
    whatsapp_icon_clicks: 15,
    whatsapp_handoffs: 9,
    leads_created: 6,
    leads_contacted: 4,
    enrollments_completed: 1
  },
  {
    utm_source: "(direct)",
    utm_medium: "(none)",
    utm_campaign: "(not_set)",
    visits: 66,
    whatsapp_icon_clicks: 22,
    whatsapp_handoffs: 13,
    leads_created: 6,
    leads_contacted: 3,
    enrollments_completed: 1
  }
];

function isTruthy(value: string): boolean {
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

function buildLeadCode(leadId: string): string {
  return `ET-${leadId.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 8)}`;
}

function isoDaysAgo(daysAgo: number, hourUtc: number, minuteUtc = 0): string {
  const date = new Date();
  date.setUTCHours(hourUtc, minuteUtc, 0, 0);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString();
}

function ratioPct(base: number, total: number): number {
  if (base <= 0 || total <= 0) return 0;
  return Number(((total / base) * 100).toFixed(2));
}

function buildDemoLeads(): DemoLeadRecord[] {
  return [
    {
      lead_status: "novo_lead",
      lead_id: "11111111-1111-4111-8111-111111111111",
      lead_code: buildLeadCode("11111111-1111-4111-8111-111111111111"),
      course_slug: "administracao",
      course_name: "Tecnico em Administracao",
      customer_name: "Perfil Demo API 01",
      customer_email: "perfil01.demo@example.com",
      customer_phone: "550000000101",
      cpf: null,
      birth_date: "1998-04-12",
      father_name: "Responsavel Demo A",
      mother_name: "Responsavel Demo B",
      address: {
        city: "Sao Paulo",
        state: "SP",
        neighborhood: "Tatuape"
      },
      payment_status: "novo_lead",
      payment_reference: null,
      payment_tid: null,
      payment_return_code: null,
      payment_return_message: null,
      created_at: isoDaysAgo(1, 14, 10),
      payment_updated_at: null,
      paid_at: null,
      first_contact_at: null,
      contact_channel: null,
      contact_owner: null
    },
    {
      lead_status: "em_atendimento",
      lead_id: "22222222-2222-4222-8222-222222222222",
      lead_code: buildLeadCode("22222222-2222-4222-8222-222222222222"),
      course_slug: "enfermagem",
      course_name: "Tecnico em Enfermagem",
      customer_name: "Perfil Demo API 02",
      customer_email: "perfil02.demo@example.com",
      customer_phone: "550000000102",
      cpf: null,
      birth_date: "1994-11-08",
      father_name: "Responsavel Demo C",
      mother_name: "Responsavel Demo D",
      address: {
        city: "Rio de Janeiro",
        state: "RJ",
        neighborhood: "Tijuca"
      },
      payment_status: "em_atendimento",
      payment_reference: null,
      payment_tid: null,
      payment_return_code: null,
      payment_return_message: null,
      created_at: isoDaysAgo(3, 13, 20),
      payment_updated_at: isoDaysAgo(2, 15, 45),
      paid_at: null,
      first_contact_at: isoDaysAgo(2, 10, 15),
      contact_channel: "whatsapp",
      contact_owner: "Equipe Demo"
    },
    {
      lead_status: "venda_concluida",
      lead_id: "33333333-3333-4333-8333-333333333333",
      lead_code: buildLeadCode("33333333-3333-4333-8333-333333333333"),
      course_slug: "informatica",
      course_name: "Tecnico em Informatica",
      customer_name: "Perfil Demo API 03",
      customer_email: "perfil03.demo@example.com",
      customer_phone: "550000000103",
      cpf: null,
      birth_date: "1996-07-19",
      father_name: "Responsavel Demo E",
      mother_name: "Responsavel Demo F",
      address: {
        city: "Belo Horizonte",
        state: "MG",
        neighborhood: "Centro"
      },
      payment_status: "venda_concluida",
      payment_reference: "demo-order-0001",
      payment_tid: "demo-tid-0001",
      payment_return_code: "00",
      payment_return_message: "approved_in_demo_mode",
      created_at: isoDaysAgo(5, 11, 30),
      payment_updated_at: isoDaysAgo(4, 16, 5),
      paid_at: isoDaysAgo(4, 16, 5),
      first_contact_at: isoDaysAgo(5, 12, 0),
      contact_channel: "phone",
      contact_owner: "Equipe Demo"
    },
    {
      lead_status: "remarketing",
      lead_id: "44444444-4444-4444-8444-444444444444",
      lead_code: buildLeadCode("44444444-4444-4444-8444-444444444444"),
      course_slug: "seguranca-do-trabalho",
      course_name: "Tecnico em Seguranca do Trabalho",
      customer_name: "Perfil Demo API 04",
      customer_email: "perfil04.demo@example.com",
      customer_phone: "550000000104",
      cpf: null,
      birth_date: "1992-02-27",
      father_name: "Responsavel Demo G",
      mother_name: "Responsavel Demo H",
      address: {
        city: "Salvador",
        state: "BA",
        neighborhood: "Pituba"
      },
      payment_status: "remarketing",
      payment_reference: null,
      payment_tid: null,
      payment_return_code: null,
      payment_return_message: "follow_up_required",
      created_at: isoDaysAgo(6, 9, 40),
      payment_updated_at: isoDaysAgo(4, 17, 30),
      paid_at: null,
      first_contact_at: isoDaysAgo(5, 14, 30),
      contact_channel: "email",
      contact_owner: "Equipe Demo"
    }
  ];
}

function buildDemoLeadIntents(): DemoLeadIntentRecord[] {
  return [
    {
      intent_id: "aaaaaaa1-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
      client_event_id: "demo-intent-001",
      intent_type: "pre_matricula_nao_concluida",
      course_slug: "administracao",
      course_name: "Tecnico em Administracao",
      customer_name: "Perfil Demo API 05",
      customer_email: "perfil05.demo@example.com",
      customer_phone: "550000000105",
      city: "Guarulhos",
      state: "SP",
      last_step: "endereco",
      last_step_label: "Endereco",
      source_url: "https://demo.escola-tecnica.example/matricula.html",
      utm_source: "meta",
      utm_medium: "paid",
      utm_campaign: "demo_adm_2026",
      utm_content: null,
      utm_term: null,
      payload: {
        reason: "exit_intent"
      },
      created_at: isoDaysAgo(1, 16, 20)
    },
    {
      intent_id: "bbbbbbb2-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
      client_event_id: "demo-intent-002",
      intent_type: "pre_qualificacao_iniciada",
      course_slug: "enfermagem",
      course_name: "Tecnico em Enfermagem",
      customer_name: "Perfil Demo API 06",
      customer_email: "perfil06.demo@example.com",
      customer_phone: "550000000106",
      city: "Niteroi",
      state: "RJ",
      last_step: "identificacao",
      last_step_label: "Identificacao",
      source_url: "https://demo.escola-tecnica.example/matricula.html",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "demo_brand_2026",
      utm_content: null,
      utm_term: "tecnico online",
      payload: {
        reason: "demo_preview"
      },
      created_at: isoDaysAgo(3, 10, 15)
    }
  ];
}

export function isDemoMode(): boolean {
  const rawDemoMode = String(process.env.DEMO_MODE || "")
    .trim()
    .toLowerCase();
  const rawAppMode = String(process.env.APP_MODE || "")
    .trim()
    .toLowerCase();
  return isTruthy(rawDemoMode) || rawAppMode === "demo";
}

export function getDemoHealthPayload() {
  return {
    ok: true,
    mode: "demo",
    detail: DEMO_DETAIL
  };
}

export function listDemoCourses(): DemoCourse[] {
  return DEMO_COURSES.map((course) => ({ ...course, track_requirements: { ...course.track_requirements } }));
}

export function getDemoLeadLookupResponse(filters: DemoLeadLookupFilters) {
  const normalizedPrefix = String(filters.leadCodePrefix || "").trim().toUpperCase();
  const normalizedStatus = String(filters.leadStatus || "").trim().toLowerCase();

  const leads = buildDemoLeads()
    .filter((lead) => {
      if (normalizedPrefix && !lead.lead_code.startsWith(normalizedPrefix)) return false;
      if (normalizedStatus && lead.lead_status !== normalizedStatus) return false;
      return true;
    })
    .slice(0, filters.limit);

  return {
    ok: true,
    demo: true,
    count: leads.length,
    leads
  };
}

export function getDemoLeadUpdateResponse(input: DemoLeadUpdateInput) {
  const existing = buildDemoLeads().find((lead) => lead.lead_id === input.leadId);
  if (!existing) return null;

  const nextStatus = input.leadStatus || existing.lead_status;
  const firstContactAt = input.shouldMarkFirstContact ? new Date().toISOString() : existing.first_contact_at;
  const contactChannel = input.contactChannel || existing.contact_channel;
  const contactOwner = input.contactOwner || existing.contact_owner;
  const paymentUpdatedAt = input.leadStatus ? new Date().toISOString() : existing.payment_updated_at;

  return {
    ok: true,
    demo: true,
    lead_id: existing.lead_id,
    lead_status: nextStatus,
    payment_status: nextStatus,
    payment_updated_at: paymentUpdatedAt,
    first_contact_at: firstContactAt,
    contact_channel: contactChannel,
    contact_owner: contactOwner
  };
}

export function getDemoLeadCreateResponse(input: DemoLeadCreateInput) {
  const selectedCourse =
    DEMO_COURSES.find((course) => course.slug === input.courseSlug) ||
    DEMO_COURSES.find((course) => course.name === input.courseName) ||
    DEMO_COURSES[0];
  const leadId = randomUUID();

  return {
    ok: true,
    demo: true,
    lead_id: leadId,
    lead_code: buildLeadCode(leadId),
    course_slug: selectedCourse.slug,
    course_name: selectedCourse.name,
    whatsapp_url: DEMO_WHATSAPP_URL,
    detail: DEMO_DETAIL
  };
}

export function getDemoLeadIntentLookupResponse(filters: DemoLeadIntentLookupFilters) {
  const normalizedIntentType = String(filters.intentType || "").trim().toLowerCase();
  const normalizedStep = String(filters.lastStepFilter || "").trim().toLowerCase();
  const normalizedCourseSlug = String(filters.courseSlug || "").trim().toLowerCase();

  const intents = buildDemoLeadIntents()
    .filter((intent) => {
      if (normalizedIntentType && intent.intent_type !== normalizedIntentType) return false;
      if (normalizedStep && intent.last_step !== normalizedStep) return false;
      if (normalizedCourseSlug && String(intent.course_slug || "").toLowerCase() !== normalizedCourseSlug) return false;
      return true;
    })
    .slice(0, filters.limit);

  return {
    ok: true,
    demo: true,
    count: intents.length,
    intents
  };
}

export function getDemoLeadIntentCreateResponse(input: DemoLeadIntentCreateInput) {
  if (!input.hasMinimumData) {
    return {
      ok: true,
      demo: true,
      stored: false,
      reason: "insufficient_data"
    };
  }

  return {
    ok: true,
    demo: true,
    stored: true,
    intent_id: randomUUID(),
    intent_type: input.intentType,
    course_slug: input.courseSlug,
    course_name: input.courseName,
    customer_name: input.customerName,
    customer_email: input.customerEmail,
    customer_phone: input.customerPhone,
    city: input.city,
    state: input.state,
    last_step: input.lastStep,
    source_url: input.sourceUrl,
    detail: DEMO_DETAIL
  };
}

export function getDemoFunnelEventResponse() {
  return {
    ok: true,
    demo: true,
    duplicate: false,
    detail: DEMO_DETAIL
  };
}

export function getDemoFunnelMetricsResponse(days: number) {
  const normalizedDays = Math.min(Math.max(Math.trunc(days) || 7, 1), 60);
  const templates = DAILY_FUNNEL_TEMPLATE.slice(-Math.min(normalizedDays, DAILY_FUNNEL_TEMPLATE.length));
  const daily = templates.map((row) => ({
    day: isoDaysAgo(row.daysAgo, 12).slice(0, 10),
    visits: row.visits,
    whatsapp_icon_clicks: row.whatsapp_icon_clicks,
    whatsapp_handoffs: row.whatsapp_handoffs,
    leads_created: row.leads_created,
    leads_contacted: row.leads_contacted,
    enrollments_completed: row.enrollments_completed,
    visit_to_whatsapp_icon_rate_pct: ratioPct(row.visits, row.whatsapp_icon_clicks),
    visit_to_whatsapp_rate_pct: ratioPct(row.visits, row.whatsapp_handoffs),
    whatsapp_icon_to_handoff_rate_pct: ratioPct(row.whatsapp_icon_clicks, row.whatsapp_handoffs),
    visit_to_lead_rate_pct: ratioPct(row.visits, row.leads_created),
    lead_to_contact_rate_pct: ratioPct(row.leads_created, row.leads_contacted),
    lead_to_enrollment_rate_pct: ratioPct(row.leads_created, row.enrollments_completed)
  }));

  const summary = daily.reduce(
    (acc, row) => {
      acc.visits += row.visits;
      acc.whatsapp_icon_clicks += row.whatsapp_icon_clicks;
      acc.whatsapp_handoffs += row.whatsapp_handoffs;
      acc.leads_created += row.leads_created;
      acc.leads_contacted += row.leads_contacted;
      acc.enrollments_completed += row.enrollments_completed;
      return acc;
    },
    {
      visits: 0,
      whatsapp_icon_clicks: 0,
      whatsapp_handoffs: 0,
      leads_created: 0,
      leads_contacted: 0,
      enrollments_completed: 0
    }
  );

  const incompleteIntents = buildDemoLeadIntents().filter(
    (intent) => intent.intent_type === "pre_matricula_nao_concluida"
  ).length;

  return {
    window_days: normalizedDays,
    generated_at: new Date().toISOString(),
    demo: true,
    summary: {
      ...summary,
      incomplete_intents: incompleteIntents,
      rates: {
        visit_to_whatsapp_icon_pct: ratioPct(summary.visits, summary.whatsapp_icon_clicks),
        visit_to_whatsapp_pct: ratioPct(summary.visits, summary.whatsapp_handoffs),
        whatsapp_icon_to_handoff_pct: ratioPct(summary.whatsapp_icon_clicks, summary.whatsapp_handoffs),
        visit_to_lead_pct: ratioPct(summary.visits, summary.leads_created),
        lead_to_contact_pct: ratioPct(summary.leads_created, summary.leads_contacted),
        lead_to_enrollment_pct: ratioPct(summary.leads_created, summary.enrollments_completed),
        contact_to_enrollment_pct: ratioPct(summary.leads_contacted, summary.enrollments_completed),
        visit_to_enrollment_pct: ratioPct(summary.visits, summary.enrollments_completed)
      }
    },
    daily,
    status_breakdown: [
      { lead_status: "novo_lead", total: 1 },
      { lead_status: "em_atendimento", total: 1 },
      { lead_status: "venda_concluida", total: 1 },
      { lead_status: "remarketing", total: 1 }
    ],
    attribution_breakdown: ATTRIBUTION_TEMPLATE.map((row) => ({
      ...row,
      visit_to_whatsapp_icon_rate_pct: ratioPct(row.visits, row.whatsapp_icon_clicks),
      visit_to_whatsapp_rate_pct: ratioPct(row.visits, row.whatsapp_handoffs),
      whatsapp_icon_to_handoff_rate_pct: ratioPct(row.whatsapp_icon_clicks, row.whatsapp_handoffs),
      visit_to_lead_rate_pct: ratioPct(row.visits, row.leads_created),
      lead_to_contact_rate_pct: ratioPct(row.leads_created, row.leads_contacted),
      lead_to_enrollment_rate_pct: ratioPct(row.leads_created, row.enrollments_completed)
    }))
  };
}
