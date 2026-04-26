import XhsPostDetailClient from "./XhsPostDetailClient";

export default async function AdminXhsPostDetailPage({ params }: { params: Promise<{ noteId: string }> }) {
  const { noteId } = await params;
  return <XhsPostDetailClient noteId={noteId} />;
}
