import type { Audience, CompetencyProfile } from '../types/training.types.js';

/**
 * E5.5: general, product-independent competency profiles. They guide which capabilities a training develops; they
 * are not a syllabus. For each product the AI selects only the competencies the documentation gives a basis for and
 * excludes the rest. Nothing here describes a specific product.
 */
export const PROFILE_VERSION = 'profiles@1';

export const COMPETENCY_PROFILES: Record<Audience, CompetencyProfile> = {
  sales: {
    audience: 'sales',
    label: 'Sales',
    purpose: 'Identify customers for whom the product is valuable, understand their needs and communicate the documented value accurately, without unsupported promises.',
    competencies: [
      { competencyId: 'sales.problem', name: 'Problema que resuelve', description: 'Comprender qué problema resuelve el producto.' },
      { competencyId: 'sales.fit', name: 'Clientes con valor', description: 'Identificar clientes para los que el producto representa valor.' },
      { competencyId: 'sales.discovery', name: 'Descubrimiento de necesidades', description: 'Hacer preguntas para entender las necesidades y procesos actuales del cliente.' },
      { competencyId: 'sales.opportunity', name: 'Oportunidades de uso', description: 'Identificar oportunidades de uso.' },
      { competencyId: 'sales.value', name: 'Propuesta de valor', description: 'Comunicar correctamente la propuesta de valor.' },
      { competencyId: 'sales.features', name: 'Explicación de funcionalidades', description: 'Explicar funcionalidades de forma clara y adecuada.' },
      { competencyId: 'sales.objections', name: 'Preguntas y objeciones', description: 'Manejar preguntas y objeciones.' },
      { competencyId: 'sales.no_overpromise', name: 'Sin promesas no respaldadas', description: 'Evitar promesas o afirmaciones no respaldadas por Producto.' },
      { competencyId: 'sales.needs_mapping', name: 'Conexión con necesidades', description: 'Conectar las funcionalidades con necesidades reales.' },
      { competencyId: 'sales.escalation', name: 'Escalamiento', description: 'Reconocer cuándo debe escalar una pregunta.' },
    ],
  },
  customer_experience: {
    audience: 'customer_experience',
    label: 'Customer Experience',
    purpose: 'Help customers use the product: explain how it works, answer questions, handle unexpected situations, set correct expectations and escalate what they cannot resolve.',
    competencies: [
      { competencyId: 'ce.how_it_works', name: 'Funcionamiento del producto', description: 'Comprender cómo funciona el producto.' },
      { competencyId: 'ce.explain', name: 'Explicación al cliente', description: 'Explicar funcionalidades y procesos al cliente.' },
      { competencyId: 'ce.guidance', name: 'Orientación de uso', description: 'Orientar al usuario en la utilización del producto.' },
      { competencyId: 'ce.faq', name: 'Preguntas frecuentes', description: 'Resolver preguntas frecuentes.' },
      { competencyId: 'ce.troubleshooting', name: 'Problemas e imprevistos', description: 'Manejar problemas y escenarios inesperados.' },
      { competencyId: 'ce.expectations', name: 'Limitaciones y expectativas', description: 'Comunicar limitaciones y expectativas correctamente.' },
      { competencyId: 'ce.scope', name: 'Alcance del producto', description: 'Ayudar al cliente a comprender qué puede y qué no puede hacer el producto.' },
      { competencyId: 'ce.escalation', name: 'Escalamiento', description: 'Identificar situaciones que requieren escalamiento.' },
      { competencyId: 'ce.boundaries', name: 'Qué resolver y qué consultar', description: 'Distinguir qué puede resolver y qué necesita consultar con Producto.' },
    ],
  },
};

export const AUDIENCE_LABELS: Record<Audience, string> = { sales: 'Sales', customer_experience: 'Customer Experience' };
