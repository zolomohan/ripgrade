import { notFound } from "next/navigation";

import { decodeShowId } from "@/lib/routes";
import { getShow } from "@/lib/shows";
import { ShowView } from "./show-view";

export const dynamic = "force-dynamic";

export default async function ShowPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;

  let decoded: string;
  try {
    decoded = decodeShowId(key);
  } catch {
    notFound();
  }

  const show = getShow(decoded!);
  if (!show) notFound();

  return (
    <main className="flex flex-col pb-16">
      <ShowView show={show} />
    </main>
  );
}
