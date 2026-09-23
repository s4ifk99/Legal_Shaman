import type { MetadataRoute } from "next";
import { getWikiIndex } from "@/lib/wiki/load-index";
import { getAllSubcategories } from "@/lib/data";

const BASE = "https://www.legalshaman.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${BASE}/search`, lastModified: now, changeFrequency: "daily", priority: 0.95 },
    { url: `${BASE}/ask-the-shaman`, lastModified: now, changeFrequency: "daily", priority: 0.95 },
    { url: `${BASE}/find-a-lawyer`, lastModified: now, changeFrequency: "daily", priority: 0.95 },
    { url: `${BASE}/signposting`, lastModified: now, changeFrequency: "monthly", priority: 0.9 },
    { url: `${BASE}/bookmarks`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/submit`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/signpost`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/for-firms`, lastModified: now, changeFrequency: "weekly", priority: 0.85 },
    { url: `${BASE}/embed/install`, lastModified: now, changeFrequency: "monthly", priority: 0.55 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
  ];

  let categoryRoutes: MetadataRoute.Sitemap = [];
  try {
    const slugs = getAllSubcategories();
    categoryRoutes = slugs.map((cat) => ({
      url: `${BASE}/category/${cat.slug}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));
  } catch {
    categoryRoutes = [];
  }

  let wikiRoutes: MetadataRoute.Sitemap = [];
  try {
    const index = getWikiIndex();
    // Blog→wiki publishes must stay in the 500-URL budget (Areas alone is ~2.6k).
    const priorityIds = new Set([
      "Areas/Consumer Rights/Faulty Goods and Services/Courier left my parcel outside and it went missing — can I use Section 75",
      "Areas/Consumer Rights/Faulty Goods and Services/A company called my private number with my name and job title — what can I do",
      "Areas/Home and Housing/Buying and Selling/Ground rent reviewed every 10 years by RPI — what should a buyer check",
      "Areas/Money, Benefits and Debt/Debt Solutions/Family spent on my credit card and won’t repay: who helps",
      "Areas/Consumer Rights/Faulty Goods and Services/Non refundable train ticket but the train never came: who helps",
      "Areas/Consumer Rights/Faulty Goods and Services/Garage fixed my car then it broke down again: who helps",
      "Areas/Driving and Parking/Parking and PCNs/Private parking charge for a short hospital stay: who helps",
      "Areas/Consumer Rights/Faulty Goods and Services/In store return done but refund never arrived: who helps",
      "Areas/Work and Employment/Discrimination at Work/Possible maternity discrimination at work: who helps",
      "Areas/Work and Employment/Redundancy and Dismissal/Dismissed in under two weeks with a baby at home: who helps",
      "Areas/Home and Housing/Repairs and Safety/House flooded from the water company's sewer again: who helps",
      "Areas/Consumer Rights/Faulty Goods and Services/Plumber's work flooded the home with sewage: who helps",
      "Areas/Driving and Parking/Motoring Offences/Parked motorcycle hit and the driver left: who helps",
      "Areas/Neighbours and Property/Noise and Nuisance/Drone flying low over my back garden: who helps",
      "Areas/Driving and Parking/Parking and PCNs/PayByPhone vs Pay By Phone parking fine: who helps",
      "Areas/Consumer Rights/Travel and Holidays/Airline oversold my flight at the airport: who helps",
      "Areas/Money, Benefits and Debt/Debt Solutions/Retailer collected goods then debt collector chased: who helps",
      "Areas/Work and Employment/Your Rights at Work/Rejected for a job over long term health: who helps",
      "Areas/Work and Employment/Your Rights at Work/Employer requires my personal phone for work: who helps",
      "Areas/Neighbours and Property/Boundaries and Rights/Neighbours dumping rubbish in shared car park: who helps",
      "Areas/Consumer Rights/Faulty Goods and Services/Skip hire wasted delivery fee dispute: who helps",
      "Areas/Driving and Parking/Motoring Offences/Parked car owner has died: who can move the vehicle",
      "Areas/Consumer Rights/Faulty Goods and Services/Long car repair dispute with ex client: who helps",
      "Areas/Consumer Rights/Travel and Holidays/Filthy holiday stay refund: who helps",
      "Areas/Neighbours and Property/Boundaries and Rights/Neighbour threats and harassment: who helps",
      "Areas/Driving and Parking/Parking and PCNs/Traffic PCN to London Tribunals: who helps",
      "Areas/Driving and Parking/Parking and PCNs/NHS staff parking charges: who helps",
      "Areas/Work and Employment/Your Rights at Work/Holiday pay on irregular hours Scotland: who helps",
      "Areas/Neighbours and Property/Noise and Nuisance/HMO neighbour noise and ASB: who helps",
      "Areas/Driving and Parking/Parking and PCNs/Parking ticket wrong registration: who helps",
      "Areas/Crime and Police/Victim Support/Assault costs after police CPS delay: who helps",
      "Areas/Consumer Rights/Faulty Goods and Services/Faulty goods outside warranty: who helps",
    ]);
    const priority = index.pages.filter((p) => priorityIds.has(p.id));
    const areas = index.pages.filter(
      (p) => p.id.startsWith("Areas/") && !priorityIds.has(p.id),
    );
    const rest = index.pages.filter(
      (p) => !p.id.startsWith("Areas/") && !priorityIds.has(p.id),
    );
    const capped = [...priority, ...areas, ...rest].slice(0, 500);
    wikiRoutes = capped.map((page) => ({
      url: `${BASE}/ask-the-shaman/wiki/${encodeURIComponent(page.id)}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: priorityIds.has(page.id)
        ? 0.75
        : page.id.startsWith("Areas/")
          ? 0.65
          : 0.5,
    }));
  } catch {
    wikiRoutes = [];
  }

  return [...staticRoutes, ...categoryRoutes, ...wikiRoutes];
}
