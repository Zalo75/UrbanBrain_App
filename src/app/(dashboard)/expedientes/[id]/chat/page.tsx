import { redirect } from 'next/navigation';

export default async function LegacyChatPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/expedientes/${id}`);
}
