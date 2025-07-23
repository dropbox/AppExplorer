export interface UserProfileProps {
  userId: string;
  displayName: string;
  email: string;
  avatar?: string;
}

export class UserProfile {
  private props: UserProfileProps;

  constructor(props: UserProfileProps) {
    this.props = props;
  }

  /**
   * Render the user profile component
   */
  render(): string {
    return `
      <div class="user-profile">
        <img src="${this.props.avatar || "/default-avatar.png"}" alt="Avatar" />
        <h2>${this.props.displayName}</h2>
        <p>${this.props.email}</p>
      </div>
    `;
  }

  /**
   * Update user profile data
   */
  updateProfile(updates: Partial<UserProfileProps>): void {
    this.props = { ...this.props, ...updates };
  }

  /**
   * Get user ID
   */
  getUserId(): string {
    return this.props.userId;
  }
}
