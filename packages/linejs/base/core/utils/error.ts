export class InternalError extends Error {
	constructor(
		readonly type: string,
		override readonly message: string,
		readonly data: Record<string, unknown> = {},
	) {
		super(message);
		this.name = type;
		this.data = data;
	}
}
