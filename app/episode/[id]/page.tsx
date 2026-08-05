import { DetailPage } from "@/app/film/[id]/detail";

export const dynamic = "force-dynamic";

export default async function EpisodePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <DetailPage id={id} expected="episode" />;
}
