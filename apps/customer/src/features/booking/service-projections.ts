import type { Service } from '@/data/catalog';
import type { BookingService } from '@/types/domain';

export type BookingServiceGroup = {
  name: string;
  description: string;
  image: number;
  sessions: BookingService[];
};

export function projectService(
  service: Service,
  duration = service.durations[0],
  depositCents = 0,
): BookingService {
  return {
    // The duration carries its own slug. Deriving one from the id produced
    // 'signature-120', which the catalog has never contained, so that booking
    // could not be priced.
    slug: duration?.slug ?? service.id,
    name: service.name,
    category: service.category === 'signature' ? 'signature' : 'specialty',
    durationMin: duration?.minutes ?? 60,
    priceCents: (duration?.price ?? 0) * 100,
    depositCents,
    description: service.description,
  };
}

export function projectServices(
  services: readonly Service[],
  depositCents = 0,
): BookingService[] {
  return services.flatMap((service) => (
    service.durations.length
      ? service.durations.map((duration) => projectService(service, duration, depositCents))
      : [projectService(service, undefined, depositCents)]
  ));
}

export function projectFirstServices(
  services: readonly Service[],
  depositCents = 0,
): BookingService[] {
  return services.map((service) => ({
    ...projectService(service, service.durations[0], depositCents),
    slug: service.id,
  }));
}

export function groupBookingServices(
  services: readonly BookingService[],
  imageForService: (slug: string) => number,
): BookingServiceGroup[] {
  const grouped = new Map<string, BookingServiceGroup>();
  for (const service of services) {
    const current = grouped.get(service.name);
    if (current) {
      current.sessions.push(service);
      continue;
    }
    grouped.set(service.name, {
      name: service.name,
      description: service.description ?? 'Made fresh, just for you.',
      image: imageForService(service.slug),
      sessions: [service],
    });
  }
  return [...grouped.values()];
}
