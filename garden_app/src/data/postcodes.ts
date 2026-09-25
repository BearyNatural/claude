/**
 * Every Australian postcode and suburb (GeoNames, CC BY 4.0), parsed on first
 * use so app start-up doesn't pay for it.
 */
import { parsePostcodeData, type PostcodePlace } from '../domain/postcodes';
import { POSTCODE_DATA } from './postcodes.generated';

let cache: PostcodePlace[] | null = null;

export function postcodePlaces(): PostcodePlace[] {
  cache ??= parsePostcodeData(POSTCODE_DATA);
  return cache;
}
