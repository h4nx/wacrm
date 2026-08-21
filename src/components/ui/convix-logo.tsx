// "Diálogo en vivo" — dos burbujas de conversación (cliente/negocio)
// superpuestas, con un pulso sólido en la burbuja frontal marcando que la
// mensajería es en tiempo real, no un chat estático. Mismo mark del favicon
// (src/app/icon.tsx), reutilizable en cualquier punto de la UI que necesite
// la marca de Convix (antes: ícono genérico de Lucide en el sidebar).
export function ConvixLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M3 5a1.5 1.5 0 0 1 1.5-1.5h9a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H9l-3.5 3v-3H4.5A1.5 1.5 0 0 1 3 11z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <path
        d="M9.5 12.5a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-.5v2.2l-2.5-2.2H11a1.5 1.5 0 0 1-1.5-1.5z"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="20" cy="10.5" r="1.5" fill="currentColor" />
    </svg>
  );
}
