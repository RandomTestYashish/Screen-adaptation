import { Body, Controller, Post } from '@nestjs/common';
import { FontAvailabilityRequest, FontAvailabilityResponse } from '@dae/shared';
import { parseOrThrow } from '../common/errors.js';

/**
 * Fonts bundled with each platform. The server can say whether a family is a
 * platform default; only the browser can say whether it is loadable right now,
 * which is why the client also reports its own results as RenderEvidence.
 */
const IOS = new Set(['sf pro', 'sf pro text', 'sf pro display', 'sf mono', 'new york', 'helvetica neue', 'helvetica', 'arial', 'georgia', 'courier new', 'times new roman', 'menlo', 'verdana']);
const ANDROID = new Set(['roboto', 'roboto condensed', 'roboto mono', 'noto sans', 'noto serif', 'droid sans', 'droid serif', 'arial', 'times new roman', 'courier new']);
const GOOGLE_FONTS = new Set(['inter', 'roboto', 'open sans', 'lato', 'montserrat', 'poppins', 'source sans 3', 'nunito', 'raleway', 'work sans', 'dm sans', 'manrope', 'plus jakarta sans', 'space grotesk', 'ibm plex sans']);

@Controller('fonts')
export class FontsController {
  @Post('availability')
  check(@Body() body: unknown) {
    const parsed = parseOrThrow(FontAvailabilityRequest, body, 'font availability request');
    return FontAvailabilityResponse.parse({
      results: parsed.families.map((family) => {
        const key = family.toLowerCase();
        if (IOS.has(key) || ANDROID.has(key)) {
          return { family, status: 'available' as const, source: 'system-font-list' as const };
        }
        if (GOOGLE_FONTS.has(key)) {
          return { family, status: 'available' as const, source: 'google-fonts' as const };
        }
        return {
          family,
          status: 'unknown' as const,
          substituteWith: 'system-ui',
          source: 'unknown' as const,
        };
      }),
    });
  }
}
