import PageTitle from "frontend/components/layout/PageTitle";
import MapBrowser from "frontend/components/maps/MapBrowser";
import Head from "next/head";

export default function MapsPage() {
  return (
    <>
      <Head>
        <title>Maps | Wars World</title>
      </Head>

      <div className="@flex @flex-col @items-center">
        <div className="@my-8 @w-full">
          {/* Map / layers glyph, matching the Material path style the other page titles use. */}
          <PageTitle svgPathD="M360-120 120-216v-544l240 96 240-96 240 96v544l-240-96-240 96Zm-40-102v-456l-120-48v456l120 48Zm320 0 120 48v-456l-120-48v456Zm-80-456v456-456Zm320-48v456-456Z">
            Maps
          </PageTitle>
        </div>

        <MapBrowser />
      </div>
    </>
  );
}
